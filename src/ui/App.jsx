import {
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
  useReactFlow,
  useViewport,
} from '@xyflow/react';
import { useArchitecture, format } from './context.jsx';
import { ArchitectureNode } from './ArchitectureNode.jsx';
import { ArchitectureEdge } from './ArchitectureEdge.jsx';
import { Failure } from './Failure.jsx';
import { Inspector } from './Inspector.jsx';
import { MapHeader } from './MapHeader.jsx';
import { MapChrome } from './MapChrome.jsx';
import { MapOverlays } from './MapOverlays.jsx';
import { usePanelNavigation } from './usePanelNavigation.jsx';
import { useMapProjection } from './useMapProjection.jsx';
import { expandedAt, isVisible } from './view.mjs';
import {
  addressFailure,
  addressKey,
  addressSnapshot,
  emptyView,
  neighbourhood,
  parseAddress,
  writeAddress,
} from '../model/address.mjs';
import { failureReport } from '../model/failure.mjs';
import { expansionThresholds, levelName } from '../model/zoom.mjs';
import { fitToFrame } from './frame.mjs';

const nodeTypes = { architecture: ArchitectureNode },
  edgeTypes = { architecture: ArchitectureEdge };
// A written address is restored once per page, by the first surface that reads it.
// A model the host swaps in afterwards is a different architecture, so it opens
// where the library decides rather than where the reader stood in the last one.
const restored = new Set();
const duration = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 280;

export const App = forwardRef(function App({ onReady, announce }, ref) {
  const { model, project, graph, layout, copy, instanceId } = useArchitecture();
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
  // The reader's filters and the last stated failure are presentation state: the
  // model never changes, only how much of it the surface is willing to draw.
  const [filters, setFilters] = useState(emptyView.filters);
  // Which surfaces beside the drawing the reader has opened. The map opens with
  // none of them: a surface stands on the canvas because somebody asked for it.
  const [surfaces, setSurfaces] = useState(emptyView.open);
  const [failure, setFailure] = useState(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const root = useRef(null),
    initialized = useRef(false),
    addressName = useRef('map'),
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
      // Framing a container has to leave it legible, or the reader is moved to a
      // box that then refuses to open. The scale its own threshold asks for is the
      // floor of the fit, with a hair over it so a rounded pixel cannot close it.
      const opens = expansionThresholds(n, size).expand;
      const atLeast =
        layout.nodes[key]?.parent === n.key || n === box
          ? Math.max(opens.width / n.width, opens.height / n.height) * 1.02
          : 0;
      return flow.setViewport(
        fitToFrame(size, n, { margin: 0.92, maxZoom, atLeast }),
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
    return flow.setViewport(fitToFrame(size, layout.bounds), {
      duration: duration(),
    });
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
  const toggleSurface = useCallback(
    (name, open) =>
      setSurfaces((held) =>
        open
          ? held.includes(name)
            ? held
            : [...held, name]
          : held.filter((entry) => entry !== name),
      ),
    [],
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
  // APG composite widget: `cursor` is the one item of the current level that Tab
  // can reach. The level, its ring and that item are derived from the projection,
  // so the pointer's hover path never decides where the keyboard stands.
  const [cursor, setCursor] = useState(null);
  const {
    interfaces,
    bundles,
    nodes,
    edges,
    outside,
    level,
    ring,
    anchor,
    named,
    scope,
  } = useMapProjection({
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
  });
  const neighbours = useMemo(
    () =>
      selected && interfaces.has(selected)
        ? neighbourhood(interfaces.get(selected), filters)
        : null,
    [selected, interfaces, filters],
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
  const firstInside = useCallback(
    (key) =>
      Object.values(layout.nodes)
        .filter((box) => box.parent === key)
        .sort((a, b) => a.y - b.y || a.x - b.x)[0]?.key,
    [layout],
  );
  const item = useCallback(
    (target) =>
      target &&
      pane.current?.querySelector(
        '[data-' + target.type + '="' + target.id + '"]',
      ),
    [],
  );
  // The keyboard's own tab stop is written to the DOM instead of rendered: React
  // Flow rebuilds an edge's element whenever the node array changes, and Chrome
  // drops focus from an SVG element whose tabindex is rewritten under it. So the
  // attribute is only ever touched where it really differs, and a move the ring
  // cannot serve yet — a container that is still opening — is retried on the next
  // commit, when its blocks exist.
  const wanted = useRef(null);
  useEffect(() => {
    const stop = item(anchor);
    for (const element of pane.current?.querySelectorAll(
      '[data-node],[data-relation]',
    ) || []) {
      const value = element === stop ? 0 : -1;
      if (element.tabIndex !== value) element.tabIndex = value;
    }
    const seeking = item(wanted.current);
    if (!seeking) return;
    wanted.current = null;
    seeking.focus({ preventScroll: true });
  }, [anchor, item, nodes, edges, panel]);
  const seek = useCallback((type, id) => {
    if (!id) return;
    wanted.current = { type, id };
    setCursor(id);
  }, []);
  const step = useCallback(
    (from, delta) => {
      const index = ring.findIndex((entry) => entry.id === from);
      if (index < 0) return;
      const next = ring[Math.max(0, Math.min(ring.length - 1, index + delta))];
      if (next && next.id !== from) seek(next.type, next.id);
    },
    [ring, seek],
  );
  // Enter is the keyboard's double-click and Space its single click, so a block
  // with an inside is entered — leaving the reader on its first part — and any
  // other item explains itself.
  const act = useCallback(
    (target, enter) => {
      if (target.type === 'relation') return showRelation(target.bundle);
      if (enter && graph.nodes.get(target.id).children) {
        seek('node', firstInside(target.id));
        return fitNode(target.id);
      }
      return showNode(target.id);
    },
    [graph, fitNode, showNode, showRelation, seek, firstInside],
  );
  const leave = useCallback(() => {
    if (!level) return up();
    seek('node', level);
    const parent = graph.parents.get(level);
    return parent ? fitNode(parent) : home();
  }, [level, graph, fitNode, home, up, seek]);

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
          Object.assign(adjusted, fitToFrame(next, layout.bounds));
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
  // The header wraps its controls when a width cannot hold them in one row, so
  // its height is a measurement rather than a constant. The pane and every
  // overlay positioned under the header read this variable, so a control pushed
  // to a second row pushes them down instead of hiding behind them.
  useEffect(() => {
    const header = root.current?.querySelector('header');
    if (!header) return undefined;
    const observer = new ResizeObserver(([entry]) =>
      root.current?.style.setProperty(
        '--header-height',
        entry.target.offsetHeight + 'px',
      ),
    );
    observer.observe(header);
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
    expanded,
    flow,
    graph,
    layout,
  ]);
  useEffect(() => {
    function keydown(e) {
      const holder = e.target.closest?.('[data-node],[data-relation]');
      const here =
        holder &&
        ring.find(
          (entry) =>
            entry.id === (holder.dataset.node || holder.dataset.relation),
        );
      if (e.key === 'Escape') {
        e.preventDefault();
        // Escape closes what is open, topmost first: the panel, then the surfaces
        // the reader opened beside the drawing, and only then does it step out of
        // the container the reader is standing in.
        if (panel) {
          closePanel();
          // The panel took the focus, so closing it has to give it back.
          if (anchor) seek(anchor.type, anchor.id);
        } else if (surfaces.length) setSurfaces(emptyView.open);
        else here ? leave() : up();
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
      // Standing on an item of the ring, the arrows and the ends belong to it;
      // otherwise Home still means the overview.
      else if (here && ['ArrowRight', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        step(here.id, 1);
      } else if (here && ['ArrowLeft', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        step(here.id, -1);
      } else if (here && (e.key === 'Home' || e.key === 'End')) {
        e.preventDefault();
        step(here.id, e.key === 'Home' ? -ring.length : ring.length);
      } else if (here && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        act(here, e.key === 'Enter');
      } else if (e.key === 'Home') {
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
  }, [
    flow,
    home,
    panel,
    surfaces,
    up,
    closePanel,
    changeZoom,
    ring,
    step,
    act,
    leave,
    seek,
    anchor,
  ]);
  const selectionName = useMemo(() => {
    if (panel?.type === 'relation')
      return (
        graph.nodes.get(panel.bundle.from).title +
        ' → ' +
        graph.nodes.get(panel.bundle.to).title
      );
    return panel?.key && graph.nodes.has(panel.key)
      ? graph.nodes.get(panel.key).title
      : null;
  }, [panel, graph]);
  const levelWords = level
    ? graph.nodes.get(level).title
    : levelName(copy, named);
  // WCAG 4.1.3: what the reader did not type — the panel that opened, the level
  // the zoom moved into — is said once, in the surface's one polite region.
  const spoken = useRef({ selection: null, level: null });
  useEffect(() => {
    if (selectionName === spoken.current.selection) return;
    spoken.current.selection = selectionName;
    if (selectionName)
      announce?.(format(copy.announcements.selected, { name: selectionName }));
  }, [selectionName, announce, copy]);
  useEffect(() => {
    if (levelWords === spoken.current.level) return;
    const first = spoken.current.level === null || !initialized.current;
    spoken.current.level = levelWords;
    if (!first)
      announce?.(format(copy.announcements.level, { level: levelWords }));
  }, [levelWords, announce, copy]);
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
      kinds: e.bundle.kinds,
      count: e.bundle.count,
      implemented: e.bundle.implemented,
      state: e.bundle.state,
      members: e.bundle.relations.map((r) => r.key),
    })),
    layer,
    layoutPasses: layout.layoutPasses,
    panel: panel?.type || null,
  });
  // The address is the surface's one written-down view: where the reader stands,
  // how close, which panel is open and what they filtered out. It is replaced,
  // never pushed, so Back still leaves the page the reader came from.
  const address = useMemo(
    () => ({
      at: selected,
      level,
      zoom: viewport.zoom,
      panel: panel?.type ?? null,
      record: panel?.type === 'record' ? panel.key : null,
      edge:
        panel?.type === 'relation'
          ? (panel.bundle.relations[0]?.key ?? null)
          : null,
      open: surfaces,
      filters,
    }),
    [selected, level, viewport.zoom, panel, filters, surfaces],
  );
  const restore = useRef(null);
  restore.current = async () => {
    const key = addressKey(
      root.current?.closest('.archivarius')?.parentElement?.id,
    );
    addressName.current = key;
    if (restored.has(key)) return;
    restored.add(key);
    // Nothing written for this mount is not a view to restore: the opening frame
    // the surface just fitted is already the right one.
    if (!writeAddress('', parseAddress(location.search, { key }), { key }))
      return;
    const view = parseAddress(location.search, { key });
    const raised = addressFailure(view, addressSnapshot(model, graph, project));
    if (raised) {
      setFailure(failureReport(raised));
      return;
    }
    setFilters(view.filters);
    setSurfaces(view.open);
    const stand = view.at ?? view.level;
    if (stand) await fitNode(stand, view.panel !== 'node');
    if (view.zoom) flow.zoomTo(view.zoom, { duration: 0 });
    if (view.panel === 'relation' && view.edge) {
      const held = bundles.find((entry) =>
        entry.bundle.relations.some((relation) => relation.key === view.edge),
      );
      if (held) showRelation(held.bundle);
    } else if (view.panel === 'record' && (view.record || view.at))
      showRecord(view.record || view.at);
    else if (
      view.panel === 'project' ||
      view.panel === 'contracts' ||
      view.panel === 'about'
    )
      openPanel({ type: view.panel });
  };
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
        home()
          .then(async () => {
            if (!active) return;
            initialized.current = true;
            await restore.current?.();
          })
          .then(() => {
            if (active) readyCallback.current?.(api);
          }),
      0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [flowReady, home, api, size.width, size.height]);
  // Writing waits a beat so a pan or a zoom leaves one address behind, not one
  // per frame.
  useEffect(() => {
    if (!initialized.current) return;
    const timer = setTimeout(() => {
      const search = writeAddress(location.search, address, {
        key: addressName.current,
      });
      history.replaceState(
        history.state,
        '',
        location.pathname + (search ? '?' + search : '') + location.hash,
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [address]);

  const overviewZoom = fitToFrame(size, layout.bounds).zoom;
  return (
    <div
      className="map-app"
      ref={root}
      tabIndex={-1}
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
      <MapHeader
        layer={layer}
        setLayer={setLayer}
        filters={filters}
        setFilters={setFilters}
        panel={panel}
        mobileMap={mobileMap}
        setMobileMap={setMobileMap}
        pane={pane}
        clearClick={clearClick}
        openPanel={openPanel}
        closePanel={closePanel}
        fitNode={fitNode}
      />
      <div
        className="map-pane"
        ref={pane}
        tabIndex={-1}
        role="region"
        aria-labelledby={instanceId + '-map-heading'}
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
        <h2 className="region-heading" id={instanceId + '-map-heading'}>
          {copy.mapRegionLabel}
        </h2>
        <ReactFlow
          id={instanceId}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={Math.min(0.025, overviewZoom)}
          maxZoom={maxZoom}
          // Mount what is visible. A model of hundreds of parts places every box the
          // level asks for, but only the ones inside the viewport - and a margin
          // around it - are kept in the document; the rest are released and mounted
          // again when the reader pans to them. Nothing here is focusable or
          // draggable, so a released box costs the reader nothing.
          onlyRenderVisibleElements
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
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
        >
          <Background gap={24} size={0.8} color="#ccd5c5" />
        </ReactFlow>
        <MapOverlays
          zoom={viewport.zoom}
          neighbours={neighbours}
          follow={fitNode}
          empty={scope.filtered && scope.parts.size === 0}
          open={surfaces}
          toggleSurface={toggleSurface}
        />
        <Failure report={failure} dismiss={() => setFailure(null)} />
      </div>
      <MapChrome
        path={path}
        home={home}
        up={up}
        fitNode={fitNode}
        changeZoom={changeZoom}
        zoom={viewport.zoom}
        overviewZoom={overviewZoom}
        activeKey={activeKey}
        outside={outside}
        clearFocus={() => {
          setSelected(null);
          setContextEnabled(false);
        }}
      />
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
