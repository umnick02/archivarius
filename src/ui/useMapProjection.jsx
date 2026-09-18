import { useCallback, useMemo } from 'react';
import { useArchitecture } from './context.jsx';
import { ArchitectureGraph } from '../model/graph.mjs';
import {
  projectLayer,
  drawsPart,
  drawnRelations,
  mountedParts,
} from '../model/projection.mjs';
import { namedLevel } from '../model/zoom.mjs';
import { isVisible, projectedEdges, placeEdgeLabels } from './view.mjs';
import { bundleSummary } from './context.jsx';
import { filterView } from '../model/address.mjs';

// Projects the validated model into what React Flow draws. Everything here is
// derived: the map holds the zoom, focus and selection, and this turns them into
// nodes, edges and the muting that answers "what does the current focus reach".
// Two of those projections are decisions rather than pixels and are made in
// `model/`: which parts a layer contains, and which of them are worth mounting.
export function useMapProjection({
  expanded,
  viewport,
  size,
  layer,
  filters,
  selected,
  activeKey,
  cursor,
  panel,
  showRelation,
}) {
  const { model, graph, layout, completion, copy } = useArchitecture();
  // A layer is a view of the snapshot: the parts outside it are absent, and what
  // it cut is stated as a boundary instead of being drawn faded.
  const projection = useMemo(
    () => projectLayer(model, graph, layer),
    [model, graph, layer],
  );
  const scope = useMemo(
    () => filterView(model, graph, filters),
    [model, graph, filters],
  );
  const interfaces = useMemo(
    () =>
      new Map(
        [...graph.nodes.keys()].map((key) => [
          key,
          ArchitectureGraph.describe(model, graph, key),
        ]),
      ),
    [model, graph],
  );
  // Every exchange the snapshot holds, so the map can still report what it knows.
  const bundles = useMemo(
    () => projectedEdges(model, graph, layout, expanded, completion.relations),
    [model, graph, layout, expanded, completion],
  );
  // The exchanges this view contains. A layer narrows an arrow to the exchanges
  // it admits and drops the arrow only when it admits none: a view that keeps
  // drawing what it excluded is not a view of anything.
  const drawn = useMemo(() => {
    const layerRelations = drawnRelations(projection);
    const admitted = scope.filtered
      ? new Set(
          [...scope.relations].filter(
            (key) => !layerRelations || layerRelations.has(key),
          ),
        )
      : layerRelations;
    return admitted
      ? projectedEdges(
          model,
          graph,
          layout,
          expanded,
          completion.relations,
          admitted,
        )
      : bundles;
  }, [model, graph, layout, expanded, completion, bundles, projection, scope]);
  const inside = useCallback(
    (key, container) => {
      while (key) {
        if (key === container) return true;
        key = graph.parents.get(key);
      }
      return false;
    },
    [graph],
  );
  const connected = useMemo(() => {
    if (!activeKey) return null;
    const result = new Set([activeKey]);
    for (const edge of drawn)
      if (
        edge.bundle.relations.some(
          (r) => inside(r.from, activeKey) || inside(r.to, activeKey),
        )
      ) {
        result.add(edge.bundle.from);
        result.add(edge.bundle.to);
      }
    return result;
  }, [activeKey, drawn, inside]);
  // The parts this view draws: inside an open container, and inside the layer.
  const shown = useMemo(
    () =>
      new Set(
        Object.keys(layout.nodes).filter(
          (key) =>
            isVisible(key, graph, expanded) &&
            drawsPart(projection, key) &&
            scope.parts.has(key),
        ),
      ),
    [layout, graph, expanded, projection, scope],
  );
  // Of those, the ones near enough the camera to be worth building in full. A
  // snapshot small enough to keep whole is kept whole, so nothing about a normal
  // map changes; a large one only builds the screenful a reader can see.
  //
  // Membership, not the camera, is what the cards are rebuilt for: the mount set
  // is recomputed on every pan but only becomes a new value when a part actually
  // joins or leaves it. Without that, virtualization would rebuild every card on
  // every frame and cost more than it saves.
  const membership = useMemo(
    () =>
      [...mountedParts({ layout, visible: shown, viewport, size })]
        .sort()
        .join('\u0000'),
    [layout, shown, viewport, size],
  );
  const mounted = useMemo(
    () => new Set(membership ? membership.split('\u0000') : []),
    [membership],
  );

  // its blocks, in reading order, and then the arrows that touch them, are the
  // ring the keyboard walks. One item of that ring carries the map's tab stop.
  const level = useMemo(() => {
    let deepest = null;
    const parents = new Set([...shown].map((key) => layout.nodes[key].parent));
    for (const key of expanded)
      if (
        shown.has(key) &&
        parents.has(key) &&
        (!deepest || layout.nodes[key].depth > layout.nodes[deepest].depth)
      )
        deepest = key;
    return deepest;
  }, [expanded, shown, layout]);
  // The chain of containers open around that level, and the name of the
  // abstraction it reveals. A reader is told which level they are reading, not
  // just how far they have zoomed.
  const named = useMemo(() => {
    const path = [];
    for (let key = level; key; key = graph.parents.get(key) ?? null)
      path.unshift(key);
    return namedLevel(graph, path);
  }, [graph, level]);
  const ring = useMemo(() => {
    const cards = Object.values(layout.nodes)
      .filter((box) => (box.parent || null) === level && shown.has(box.key))
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((box) => ({ type: 'node', id: box.key }));
    const here = new Set(cards.map((card) => card.id));
    return [
      ...cards,
      ...drawn
        .filter(
          (edge) => here.has(edge.bundle.from) || here.has(edge.bundle.to),
        )
        .map((edge) => ({
          type: 'relation',
          id: edge.id,
          bundle: edge.bundle,
        })),
    ];
  }, [layout, shown, drawn, level]);
  const anchor =
    ring.find((item) => item.id === cursor) ||
    ring.find((item) => item.type === 'node' && item.id === selected) ||
    ring[0] ||
    null;
  // Arrows the camera can reach, plus every arrow the keyboard ring names, so a
  // reader who navigates without a pointer never loses a stop to virtualization.
  const near = useMemo(() => {
    if (mounted.size === shown.size) return drawn;
    const reachable = new Set(ring.map((item) => item.id));
    return drawn.filter(
      (edge) =>
        reachable.has(edge.id) ||
        mounted.has(edge.bundle.from) ||
        mounted.has(edge.bundle.to),
    );
  }, [drawn, mounted, shown, ring]);
  const nodes = useMemo(
    () =>
      Object.values(layout.nodes).map((box) => {
        const handles = [];
        for (const edge of drawn) {
          if (edge.bundle.from === box.key)
            handles.push({
              ...edge.source,
              id: 's-' + edge.id,
              type: 'source',
            });
          if (edge.bundle.to === box.key)
            handles.push({
              ...edge.target,
              id: 't-' + edge.id,
              type: 'target',
            });
        }
        const parent = box.parent ? layout.nodes[box.parent] : null;
        return {
          id: box.key,
          type: 'architecture',
          parentId: box.parent || undefined,
          extent: parent ? 'parent' : undefined,
          position: {
            x: box.x - (parent?.x || 0),
            y: box.y - (parent?.y || 0),
          },
          width: box.width,
          height: box.height,
          hidden: !shown.has(box.key),
          draggable: false,
          selectable: false,
          data: {
            item: graph.nodes.get(box.key),
            interfaces: interfaces.get(box.key),
            box,
            handles,
            expanded: expanded.has(box.key),
            // A part the camera cannot reach keeps its place and its outline and
            // spends nothing on the detail nobody is looking at.
            mounted: mounted.has(box.key),
            highlighted: selected === box.key,
            muted:
              !!connected &&
              !connected.has(box.key) &&
              !inside(box.key, activeKey) &&
              !inside(activeKey, box.key),
          },
          style: { width: box.width, height: box.height },
          zIndex: box.depth,
        };
      }),
    [
      layout,
      graph,
      interfaces,
      drawn,
      shown,
      mounted,
      expanded,
      selected,
      connected,
      activeKey,
      inside,
    ],
  );
  const edges = useMemo(
    () =>
      placeEdgeLabels(near, nodes, viewport, size, (bundle) =>
        bundleSummary(copy, bundle),
      ).map((edge) => ({
        id: edge.id,
        type: 'architecture',
        source: edge.bundle.from,
        target: edge.bundle.to,
        sourceHandle: 's-' + edge.id,
        targetHandle: 't-' + edge.id,
        selectable: false,
        zIndex: 20,
        // The arrow's own group carries no role and no name: the thing a reader
        // operates is the button inside it, and a named landmark wrapped around
        // a control would nest one interactive element in another.
        ariaRole: 'presentation',
        ariaLabel: null,
        data: {
          ...edge,
          onOpen: showRelation,
          // Only the focus mutes an arrow now. The layer no longer needs to: what
          // it excluded is not here to mute.
          muted:
            !!activeKey &&
            !edge.bundle.relations.some(
              (r) => inside(r.from, activeKey) || inside(r.to, activeKey),
            ),
          active:
            panel?.type === 'relation' &&
            edge.bundle.relations.some((e) =>
              panel.bundle.relations.some((p) => p.key === e.key),
            ),
        },
      })),
    [near, nodes, viewport, size, panel, showRelation, activeKey, inside, copy],
  );
  // Connections that leave the focused subtree, so a reader sees what it touches
  // without the map having to draw the whole neighbourhood.
  const outside = activeKey
    ? [
        ...new Set([
          ...(interfaces.get(activeKey)?.incoming || []).map((r) => r.from),
          ...(interfaces.get(activeKey)?.outgoing || []).map((r) => r.to),
        ]),
      ].filter((key) => !inside(key, activeKey))
    : [];
  return {
    interfaces,
    bundles,
    nodes,
    edges,
    outside,
    level,
    named,
    projection,
    mounted,
    ring,
    anchor,
    scope,
  };
}
