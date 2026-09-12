import React, {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  Background,
  MiniMap,
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import { useArchitecture } from './context.jsx';
import { ArchitectureNode } from './ArchitectureNode.jsx';
import { ArchitectureEdge } from './ArchitectureEdge.jsx';
import { Inspector } from './Inspector.jsx';
import { ArchitectureGraph } from './graph.mjs';
import {
  kindColors,
  expandedAt,
  isVisible,
  projectedEdges,
  placeEdgeLabels,
} from './view.mjs';

const nodeTypes = { architecture: ArchitectureNode },
  edgeTypes = { architecture: ArchitectureEdge };
const duration = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;

export const App = forwardRef(function App({ onReady }, ref) {
  const { model, graph, layout, copy, rootColors, instanceId } =
    useArchitecture();
  const flow = useReactFlow(),
    viewport = useViewport();
  const maxZoom = useMemo(
    () =>
      Math.max(
        160,
        ...Object.values(layout.nodes).map(
          (node) => 560 / Math.min(node.width, node.height),
        ),
      ),
    [layout],
  );
  const [size, setSize] = useState({ width: 1440, height: 924 });
  const [flowReady, setFlowReady] = useState(false);
  const [layer, setLayer] = useState('all'),
    [panel, setPanel] = useState(null),
    [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(null);
  const root = useRef(null),
    initialized = useRef(false),
    readyCallback = useRef(onReady),
    pane = useRef(null),
    pointer = useRef(null),
    pendingClick = useRef(null),
    previousExpanded = useRef(new Set()),
    explicitFocus = useRef(null);
  const expanded = useMemo(() => {
    const next = expandedAt(
      layout,
      viewport.zoom,
      size,
      previousExpanded.current,
    );
    previousExpanded.current = next;
    return next;
  }, [layout, viewport.zoom, size]);
  const expansionKey = [...expanded].join('/');
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
    () => projectedEdges(model, graph, layout, expanded),
    [model, graph, layout, expansionKey],
  );
  const clearClick = useCallback(() => {
    clearTimeout(pendingClick.current);
  }, []);
  useEffect(() => clearClick, [clearClick]);
  const fitNode = useCallback(
    (key) => {
      clearClick();
      if (!graph.nodes.has(key)) throw new Error('UNKNOWN_NODE:' + key);
      const leaf = !graph.nodes.get(key).children;
      setPanel(leaf ? { type: 'node', key } : null);
      setSelected(key);
      explicitFocus.current = key;
      setFocus(key);
      const box = layout.nodes[key],
        n = leaf
          ? box.parent
            ? layout.nodes[box.parent]
            : layout.bounds
          : box,
        size = {
          width: pane.current.clientWidth,
          height: pane.current.clientHeight,
        };
      const zoom = Math.min(
        maxZoom,
        Math.min(
          (size.width - (size.width < 780 ? 48 : leaf ? 460 : 130)) / n.width,
          (size.height - 170) / n.height,
        ) * 0.92,
      );
      return flow.setViewport(
        {
          x:
            (size.width - (leaf && size.width >= 780 ? 376 : 0)) / 2 -
            (n.x + n.width / 2) * zoom,
          y: size.height / 2 + 12 - (n.y + n.height / 2) * zoom,
          zoom,
        },
        { duration: duration() },
      );
    },
    [flow, graph, layout, maxZoom, clearClick],
  );
  const home = useCallback(() => {
    clearClick();
    setPanel(null);
    setSelected(null);
    explicitFocus.current = null;
    pointer.current = null;
    setFocus(null);
    const size = {
      width: pane.current.clientWidth,
      height: pane.current.clientHeight,
    };
    const b = layout.bounds,
      zoom = Math.min(
        (size.width - 70) / b.width,
        (size.height - 180) / b.height,
      );
    return flow.setViewport(
      {
        x: (size.width - b.width * zoom) / 2,
        y: (size.height - b.height * zoom) / 2 + 10,
        zoom,
      },
      { duration: duration() },
    );
  }, [flow, layout, clearClick]);
  const showNode = useCallback(
    (key) => {
      clearClick();
      setSelected(key);
      setPanel({ type: 'node', key });
    },
    [clearClick],
  );
  const showRelation = useCallback(
    (bundle) => {
      clearClick();
      setSelected(null);
      setPanel({ type: 'relation', bundle });
    },
    [clearClick],
  );
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
      expansionKey,
      fitNode,
      showNode,
      selected,
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
          muted: layer !== 'all' && edge.bundle.kind !== layer,
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
      viewport.x,
      viewport.y,
      viewport.zoom,
      size,
      panel,
      showRelation,
      layer,
    ],
  );
  const path = useMemo(() => {
    const result = [];
    let key = focus;
    while (key) {
      if (expanded.has(key)) result.unshift(key);
      key = graph.parents.get(key);
    }
    return result;
  }, [graph, focus, expansionKey]);
  const up = useCallback(() => {
    const key = path.at(-1),
      parent = key && graph.parents.get(key);
    parent ? fitNode(parent) : home();
  }, [graph, path, fitNode, home]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(pane.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (explicitFocus.current) return;
    const rect = pane.current.getBoundingClientRect();
    const screen = pointer.current || {
      x: rect.left + size.width / 2,
      y: rect.top + size.height / 2,
    };
    const p = flow.screenToFlowPosition(screen);
    const hit = Object.values(layout.nodes)
      .filter(
        (n) =>
          isVisible(n.key, graph, expanded) &&
          p.x >= n.x &&
          p.x <= n.x + n.width &&
          p.y >= n.y &&
          p.y <= n.y + n.height,
      )
      .sort((a, b) => b.depth - a.depth)[0];
    setFocus(hit?.key || null);
  }, [
    viewport.x,
    viewport.y,
    viewport.zoom,
    size,
    expansionKey,
    flow,
    graph,
    layout,
  ]);
  useEffect(() => {
    function keydown(e) {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        panel ? setPanel(null) : up();
      } else if (e.key === 'Home') {
        e.preventDefault();
        home();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        flow.zoomIn({ duration: duration() });
      } else if (e.key === '-') {
        e.preventDefault();
        flow.zoomOut({ duration: duration() });
      }
    }
    const element = root.current;
    element.addEventListener('keydown', keydown);
    return () => element.removeEventListener('keydown', keydown);
  }, [flow, home, panel, up]);
  const snapshot = useRef(null);
  snapshot.current = () => ({
    viewport: flow.getViewport(),
    expanded: [...expanded],
    visible: nodes.filter((n) => !n.hidden).map((n) => n.id),
    nodeGeometry: nodes.map((n) => ({
      id: n.id,
      position: n.position,
      width: n.width,
      height: n.height,
    })),
    relations: bundles.map((e) => ({
      from: e.bundle.from,
      to: e.bundle.to,
      kind: e.bundle.kind,
      implemented: e.bundle.implemented,
      members: e.bundle.relations.map((r) => r.key),
    })),
    layer,
    layoutPasses: layout.layoutPasses,
    panel: panel?.type || null,
  });
  const api = useMemo(
    () => ({
      home,
      focus: fitNode,
      snapshot: () => structuredClone(snapshot.current()),
    }),
    [home, fitNode],
  );
  useImperativeHandle(ref, () => api, [api]);
  useEffect(() => {
    if (
      !flowReady ||
      initialized.current ||
      size.width <= 0 ||
      size.height <= 0
    )
      return;
    let active = true;
    const timer = setTimeout(
      () =>
        home().then(() => {
          if (active) {
            initialized.current = true;
            readyCallback.current?.(api);
          }
        }),
      0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [flowReady, home, api, size.width, size.height]);

  const overviewZoom = Math.min(
    (size.width - 70) / layout.bounds.width,
    (size.height - 180) / layout.bounds.height,
  );
  return (
    <div
      className="map-app"
      ref={root}
      tabIndex={0}
      role="region"
      aria-label={model.title || copy.title}
      data-engine="react-flow"
      data-layout="elkjs"
      onPointerDownCapture={(e) => {
        if (!e.target.closest('button,input,select,textarea,summary,a'))
          root.current.focus({ preventScroll: true });
      }}
    >
      <header>
        <div className="identity">
          <div className="logo">↗</div>
          <div>
            <div className="brand">
              {copy.brand} <span>/</span> {model.title || copy.title}
            </div>
            <div className="subtitle">{copy.subtitle}</div>
          </div>
        </div>
        <div className="header-right">
          <select
            data-control="node-search"
            aria-label={copy.findNode}
            value=""
            onChange={(e) => fitNode(e.target.value)}
          >
            <option value="" disabled>
              {copy.findNode}
            </option>
            {[...graph.nodes.values()].map((node) => (
              <option key={node.key} value={node.key}>
                {node.title}
              </option>
            ))}
          </select>
          <select
            data-control="layer"
            aria-label={copy.layerLabel}
            value={layer}
            onChange={(e) => {
              clearClick();
              setLayer(e.target.value);
              setPanel(null);
            }}
          >
            {Object.entries(copy.layers).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="quiet"
            data-control="contracts"
            onClick={() => {
              clearClick();
              setPanel({ type: 'contracts' });
            }}
          >
            {copy.rulesButton}
          </button>
          <button
            className="quiet"
            data-control="about"
            onClick={() => setPanel({ type: 'about' })}
          >
            {copy.aboutButton}
          </button>
        </div>
      </header>
      <div
        className="map-pane"
        ref={pane}
        onPointerMoveCapture={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
        }}
        onWheelCapture={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
          explicitFocus.current = null;
          clearClick();
        }}
      >
        <ReactFlow
          id={instanceId}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={Math.min(0.025, overviewZoom)}
          maxZoom={maxZoom}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          zoomOnDoubleClick={false}
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          panOnDrag
          preventScrolling
          onInit={() => setFlowReady(true)}
          onMoveStart={(event) => {
            clearClick();
            if (event) explicitFocus.current = null;
          }}
          onNodeClick={(_, n) => {
            clearClick();
            pendingClick.current = setTimeout(() => showNode(n.id), 320);
          }}
          onNodeDoubleClick={(_, n) => fitNode(n.id)}
          onEdgeClick={(_, e) => showRelation(e.data.bundle)}
          attributionPosition="bottom-left"
          ariaLabelConfig={{ 'minimap.ariaLabel': copy.minimapLabel }}
        >
          <Background gap={24} size={0.8} color="#ccd5c5" />
          <MiniMap
            style={{
              width: size.width < 780 ? 92 : 170,
              height: size.width < 780 ? 68 : 104,
            }}
            pannable
            zoomable
            nodeColor={(n) => rootColors[layout.nodes[n.id].root] + '25'}
            nodeStrokeColor={(n) => rootColors[layout.nodes[n.id].root]}
            nodeStrokeWidth={2}
            maskColor="#f9fbf3bb"
            position="bottom-left"
          />
        </ReactFlow>
        <svg width="0" height="0" className="marker-definitions">
          <defs>
            {Object.entries(kindColors).map(([kind, color]) => (
              <marker
                key={kind}
                id={instanceId + '-head-' + kind}
                viewBox="0 0 8 8"
                refX="8"
                refY="4"
                markerWidth={7 / viewport.zoom}
                markerHeight={7 / viewport.zoom}
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M 1 1 L 7 4 L 1 7"
                  fill="none"
                  stroke={color}
                  strokeWidth="1.2"
                />
              </marker>
            ))}
          </defs>
        </svg>
      </div>
      <nav data-control="breadcrumbs" aria-label={copy.positionLabel}>
        <button onClick={home}>{copy.wholeSystem}</button>
        {path.map((key) => (
          <React.Fragment key={key}>
            <span>/</span>
            <button onClick={() => fitNode(key)}>
              {graph.nodes.get(key).title}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <div className="hint">
        <strong>{copy.hints.zoom}</strong> · {copy.hints.pan}
        <br />
        {copy.hints.enter} · {copy.hints.edge}
        <br />
        <span style={{ color: kindColors.data }}>
          ━ {copy.layers.data}
        </span> ·{' '}
        <span style={{ color: kindColors.command }}>
          ┄ {copy.layers.command}
        </span>{' '}
        · <span style={{ color: kindColors.state }}>┈ {copy.layers.state}</span>
      </div>
      <div className="map-controls">
        <button
          data-control="back"
          aria-label={copy.up}
          disabled={!path.length}
          onClick={up}
        >
          ↰
        </button>
        <i />
        <button
          data-control="minus"
          aria-label={copy.zoomOut}
          onClick={() => flow.zoomOut({ duration: duration() })}
        >
          −
        </button>
        <span data-control="zoom-label">
          {Math.round((viewport.zoom / overviewZoom) * 100)}%
        </span>
        <button
          data-control="plus"
          aria-label={copy.zoomIn}
          onClick={() => flow.zoomIn({ duration: duration() })}
        >
          +
        </button>
        <i />
        <button
          data-control="home"
          aria-label={copy.wholeArchitecture}
          onClick={home}
        >
          ⌂
        </button>
      </div>
      <Inspector
        panel={panel}
        interfaces={panel?.type === 'node' ? interfaces.get(panel.key) : null}
        fitNode={fitNode}
        showRelation={showRelation}
        close={() => setPanel(null)}
      />
    </div>
  );
});
