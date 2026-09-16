import { useCallback, useMemo } from 'react';
import { useArchitecture } from './context.jsx';
import { ArchitectureGraph } from '../model/graph.mjs';
import { isVisible, projectedEdges, placeEdgeLabels } from './view.mjs';

// Projects the validated model into what React Flow draws. Everything here is
// derived: the map holds the zoom, focus and selection, and this turns them into
// nodes, edges and the muting that answers "what does the current focus reach".
export function useMapProjection({
  expanded,
  viewport,
  size,
  layer,
  selected,
  activeKey,
  panel,
  fitNode,
  showNode,
  showRelation,
}) {
  const { model, graph, layout, completion } = useArchitecture();
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
  const bundles = useMemo(
    () => projectedEdges(model, graph, layout, expanded, completion.relations),
    [model, graph, layout, expanded, completion],
  );
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
    for (const edge of bundles)
      if (
        edge.bundle.relations.some(
          (r) => inside(r.from, activeKey) || inside(r.to, activeKey),
        )
      ) {
        result.add(edge.bundle.from);
        result.add(edge.bundle.to);
      }
    return result;
  }, [activeKey, bundles, inside]);
  const nodes = useMemo(
    () =>
      Object.values(layout.nodes).map((box) => {
        const handles = [];
        for (const edge of bundles) {
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
          hidden: !isVisible(box.key, graph, expanded),
          draggable: false,
          selectable: false,
          data: {
            item: graph.nodes.get(box.key),
            interfaces: interfaces.get(box.key),
            box,
            handles,
            expanded: expanded.has(box.key),
            onEnter: fitNode,
            onDetails: showNode,
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
      bundles,
      expanded,
      fitNode,
      showNode,
      selected,
      connected,
      activeKey,
      inside,
    ],
  );
  const edges = useMemo(
    () =>
      placeEdgeLabels(bundles, nodes, viewport, size, layer).map((edge) => ({
        id: edge.id,
        type: 'architecture',
        source: edge.bundle.from,
        target: edge.bundle.to,
        sourceHandle: 's-' + edge.id,
        targetHandle: 't-' + edge.id,
        selectable: false,
        zIndex: 20,
        data: {
          ...edge,
          onOpen: showRelation,
          muted:
            (layer !== 'all' && edge.bundle.kind !== layer) ||
            (!!activeKey &&
              !edge.bundle.relations.some(
                (r) => inside(r.from, activeKey) || inside(r.to, activeKey),
              )),
          active:
            panel?.type === 'relation' &&
            edge.bundle.relations.some((e) =>
              panel.bundle.relations.some((p) => p.key === e.key),
            ),
        },
      })),
    [
      bundles,
      nodes,
      viewport,
      size,
      panel,
      showRelation,
      layer,
      activeKey,
      inside,
    ],
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
  return { interfaces, bundles, nodes, edges, outside };
}
