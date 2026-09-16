import {
  Fragment,
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
import { ImplementationMark } from './ImplementationMark.jsx';
import { Inspector } from './Inspector.jsx';
import { usePanelNavigation } from './usePanelNavigation.jsx';
import { ArchitectureGraph } from '../model/graph.mjs';
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
  const {
    model,
    project,
    projectCopy,
    completion,
    graph,
    layout,
    copy,
    rootColors,
    instanceId,
  } = useArchitecture();
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
    [selected, setSelected] = useState(null),
    [focus, setFocus] = useState(null);
  const [mobileMap, setMobileMap] = useState(false);
  const [contextEnabled, setContextEnabled] = useState(true);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const root = useRef(null),
    initialized = useRef(false),
    readyCallback = useRef(onReady),
    pane = useRef(null),
    pointer = useRef(null),
    pendingClick = useRef(null),
    previousExpanded = useRef(new Set()),
    explicitFocus = useRef(null),
    atHome = useRef(true),
    fitting = useRef(0);
  const navigation = usePanelNavigation(
    root,
    project && !graph.nodes.size ? { type: 'project' } : null,
    () => ({
      viewport: flow.getViewport(),
      selected,
      focus,
      atHome: atHome.current,
      contextEnabled,
    }),
    (scene) => {
      setSelected(scene.selected);
      setFocus(scene.focus);
      explicitFocus.current = scene.focus;
      atHome.current = scene.atHome;
      setContextEnabled(scene.contextEnabled);
      flow.setViewport(scene.viewport);
    },
  );
  const {
    panel,
    open: openPanel,
    close: closePanel,
    reset: resetPanel,
  } = navigation;
  useEffect(() => setMobileMap(false), [panel?.entryId]);
  useEffect(() => {
    if (mobileMap) pane.current?.focus({ preventScroll: true });
  }, [mobileMap]);
  const expanded = useMemo(() => {
    const previous = previousExpanded.current;
    const next = expandedAt(layout, viewport.zoom, size, previous);
    // Same expansion means the same object, so dependent memos and effects
    // observe expansion content rather than recomputation.
    if (
      previous.size === next.size &&
      [...next].every((key) => previous.has(key))
    )
      return previous;
    previousExpanded.current = next;
    return next;
  }, [layout, viewport.zoom, size]);
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
  const clearClick = useCallback(() => {
    clearTimeout(pendingClick.current);
  }, []);
  const changeZoom = useCallback(
    (direction) => {
      atHome.current = false;
      setContextEnabled(true);
      return direction > 0
        ? flow.zoomIn({ duration: duration() })
        : flow.zoomOut({ duration: duration() });
    },
    [flow],
  );
  useEffect(
    () => () => {
      clearClick();
      fitting.current++;
    },
    [clearClick],
  );
  const fitNode = useCallback(
    async (key, keepPanel = false) => {
      clearClick();
      if (!graph.nodes.has(key)) throw new Error('UNKNOWN_NODE:' + key);
      const leaf = !graph.nodes.get(key).children;
      const ticket = ++fitting.current;
      atHome.current = false;
      setContextEnabled(true);
      if (!keepPanel) leaf ? openPanel({ type: 'node', key }) : closePanel();
      setSelected(key);
      explicitFocus.current = key;
      setFocus(key);
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (ticket !== fitting.current) return false;
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
          Math.max(60, size.width - 48) / n.width,
          (size.height - 170) / n.height,
        ) * 0.92,
      );
      return flow.setViewport(
        {
          x: size.width / 2 - (n.x + n.width / 2) * zoom,
          y: size.height / 2 + 12 - (n.y + n.height / 2) * zoom,
          zoom,
        },
        { duration: duration() },
      );
    },
    [flow, graph, layout, maxZoom, clearClick, openPanel, closePanel],
  );
  const home = useCallback(async () => {
    clearClick();
    const ticket = ++fitting.current;
    atHome.current = true;
    resetPanel(
      project &&
        (!graph.nodes.size ||
          (!initialized.current && root.current.clientWidth <= 780))
        ? { type: 'project' }
        : null,
    );
    setSelected(null);
    setContextEnabled(true);
    explicitFocus.current = null;
    pointer.current = null;
    setFocus(null);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (ticket !== fitting.current) return false;
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
  }, [flow, layout, clearClick, project, graph, resetPanel]);
  const showNode = useCallback(
    (key) => {
      clearClick();
      openPanel({ type: 'node', key });
      setSelected(key);
      setContextEnabled(true);
    },
    [clearClick, openPanel],
  );
  const showRelation = useCallback(
    (bundle) => {
      clearClick();
      openPanel({ type: 'relation', bundle });
      setSelected(null);
    },
    [clearClick, openPanel],
  );
  const showRecord = useCallback(
    (key) => {
      clearClick();
      openPanel({ type: 'record', key });
      if (graph.nodes.has(key)) {
        setSelected(key);
        setContextEnabled(true);
      }
    },
    [clearClick, openPanel, graph],
  );
  const showOnMap = useCallback(
    async (key) => {
      await fitNode(key, true);
      setMobileMap(true);
      pane.current?.focus({ preventScroll: true });
    },
    [fitNode],
  );
  let zoomScope = focus;
  while (zoomScope && !expanded.has(zoomScope))
    zoomScope = graph.parents.get(zoomScope);
  const activeKey = contextEnabled ? selected || zoomScope : null;
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
  const path = useMemo(() => {
    const result = [];
    let key = focus;
    while (key) {
      if (expanded.has(key)) result.unshift(key);
      key = graph.parents.get(key);
    }
    return result;
  }, [graph, focus, expanded]);
  const up = useCallback(() => {
    const key = path.at(-1),
      parent = key && graph.parents.get(key);
    parent ? fitNode(parent) : home();
  }, [graph, path, fitNode, home]);

  useEffect(() => {
    let previous;
    const observer = new ResizeObserver(([entry]) => {
      const next = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      if (previous && initialized.current) {
        const current = flow.getViewport();
        const adjusted = {
          ...current,
          x: current.x + (next.width - previous.width) / 2,
          y: current.y + (next.height - previous.height) / 2,
        };
        const selectedBox = layout.nodes[selectedRef.current];
        if (atHome.current) {
          const bounds = layout.bounds;
          adjusted.zoom = Math.min(
            (next.width - 70) / bounds.width,
            (next.height - 180) / bounds.height,
          );
          adjusted.x = (next.width - bounds.width * adjusted.zoom) / 2;
          adjusted.y = (next.height - bounds.height * adjusted.zoom) / 2 + 10;
        } else if (selectedBox && next.width < previous.width) {
          const left = selectedBox.x * current.zoom + adjusted.x;
          const width = selectedBox.width * current.zoom;
          adjusted.x +=
            width > next.width - 48
              ? next.width / 2 - left - width / 2
              : left < 24
                ? 24 - left
                : left + width > next.width - 24
                  ? next.width - 24 - left - width
                  : 0;
        }
        flow.setViewport(adjusted);
      }
      previous = next;
      setSize(next);
    });
    observer.observe(pane.current);
    return () => observer.disconnect();
  }, [flow, layout]);
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
    expanded,
    flow,
    graph,
    layout,
  ]);
  useEffect(() => {
    function keydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        panel ? closePanel() : up();
      } else if (e.key === 'F6') {
        e.preventDefault();
        const inspector = root.current.querySelector(
          '[data-control="inspector"]',
        );
        if (root.current.clientWidth <= 780 && panel)
          setMobileMap((value) => !value);
        else if (
          inspector &&
          !inspector.hidden &&
          !inspector.contains(document.activeElement)
        )
          inspector.focus();
        else pane.current.focus();
      } else if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))
        return;
      else if (e.key === 'Home') {
        e.preventDefault();
        home();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        changeZoom(1);
      } else if (e.key === '-') {
        e.preventDefault();
        changeZoom(-1);
      }
    }
    const element = root.current;
    element.addEventListener('keydown', keydown);
    return () => element.removeEventListener('keydown', keydown);
  }, [flow, home, panel, up, closePanel, changeZoom]);
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
      state: e.bundle.state,
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
      inspect: (key) => {
        if (project) {
          if (!project.records.some((r) => r.key === key))
            throw new Error('UNKNOWN_RECORD:' + key);
          showRecord(key);
        } else {
          if (!graph.nodes.has(key)) throw new Error('UNKNOWN_NODE:' + key);
          showNode(key);
        }
      },
      snapshot: () => structuredClone(snapshot.current()),
    }),
    [home, fitNode, project, graph, showRecord, showNode],
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
  const outside = activeKey
    ? [
        ...new Set([
          ...(interfaces.get(activeKey)?.incoming || []).map((r) => r.from),
          ...(interfaces.get(activeKey)?.outgoing || []).map((r) => r.to),
        ]),
      ].filter((key) => !inside(key, activeKey))
    : [];
  return (
    <div
      className="map-app"
      ref={root}
      tabIndex={0}
      role="region"
      aria-label={model.title || copy.title}
      data-engine="react-flow"
      data-layout="elkjs"
      data-panel-open={String(!!panel)}
      data-mobile-reading={String(!!panel && !mobileMap)}
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
          {project && (
            <button
              className="quiet"
              data-control="project"
              onClick={() => {
                clearClick();
                openPanel({ type: 'project' });
              }}
            >
              {projectCopy.button}
            </button>
          )}
          {project ? (
            <button
              className="quiet"
              data-control="project-search"
              onClick={() =>
                openPanel({
                  type: 'project',
                  view: 'all',
                  focusSearch: true,
                })
              }
            >
              {projectCopy.search}
            </button>
          ) : (
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
          )}
          <select
            data-control="layer"
            aria-label={copy.layerLabel}
            value={layer}
            onChange={(e) => {
              clearClick();
              setLayer(e.target.value);
              closePanel();
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
              openPanel({ type: 'contracts' });
            }}
          >
            {copy.rulesButton}
          </button>
          <button
            className="quiet"
            data-control="about"
            onClick={() => openPanel({ type: 'about' })}
          >
            {copy.aboutButton}
          </button>
        </div>
      </header>
      {panel && (
        <div className="mobile-view-switch">
          <button
            className="quiet"
            data-control="mobile-map"
            aria-pressed={mobileMap}
            onClick={() => {
              setMobileMap(true);
              pane.current?.focus({ preventScroll: true });
            }}
          >
            {projectCopy.returnToMap}
          </button>
          <button
            className="quiet"
            data-control="mobile-card"
            aria-pressed={!mobileMap}
            onClick={() => setMobileMap(false)}
          >
            {projectCopy.returnToCard}
          </button>
        </div>
      )}
      <div
        className="map-pane"
        ref={pane}
        tabIndex={-1}
        aria-label={copy.wholeArchitecture}
        onPointerMoveCapture={(e) => {
          pointer.current = { x: e.clientX, y: e.clientY };
        }}
        onWheelCapture={(e) => {
          atHome.current = false;
          setContextEnabled(true);
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
            if (event) {
              explicitFocus.current = null;
              atHome.current = false;
            }
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
        {!!graph.nodes.size && (
          <div
            className="implementation-legend"
            data-control="implementation-legend"
            title={copy.implementationUnconfirmed}
          >
            <strong>{copy.mapImplementation.label}</strong>
            {['confirmed', 'partial', 'unconfirmed'].map((state) => (
              <span key={state}>
                <ImplementationMark state={state} />
                {copy.mapImplementation[state]}
              </span>
            ))}
          </div>
        )}
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
          <Fragment key={key}>
            <span>/</span>
            <button onClick={() => fitNode(key)}>
              {graph.nodes.get(key).title}
            </button>
          </Fragment>
        ))}
      </nav>
      {activeKey && (
        <div className="map-context">
          <button
            className="quiet"
            data-control="clear-focus"
            onClick={() => {
              setSelected(null);
              setContextEnabled(false);
            }}
          >
            {projectCopy.clearFocus}
          </button>
          {!!outside.length && (
            <details className="external-connections">
              <summary>
                {projectCopy.external} · {outside.length}
              </summary>
              {outside.map((key) => (
                <button
                  className="record-link"
                  data-external-node={key}
                  key={key}
                  onClick={() => fitNode(key)}
                >
                  {graph.nodes.get(key).title}
                </button>
              ))}
            </details>
          )}
        </div>
      )}
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
          onClick={() => changeZoom(-1)}
        >
          −
        </button>
        <span data-control="zoom-label">
          {Math.round((viewport.zoom / overviewZoom) * 100)}%
        </span>
        <button
          data-control="plus"
          aria-label={copy.zoomIn}
          onClick={() => changeZoom(1)}
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
        interfaces={panel?.key ? interfaces.get(panel.key) : null}
        fitNode={fitNode}
        showOnMap={showOnMap}
        showRelation={showRelation}
        showRecord={showRecord}
        overview={() => openPanel({ type: 'project' })}
        close={closePanel}
        navigation={navigation}
        hidden={mobileMap && root.current?.clientWidth <= 780}
      />
    </div>
  );
});
