import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { buildLayout, checkLayout } from '../src/layout/layout.mjs';
import { ArchitectureGraph as Graph } from '../src/model/graph.mjs';
import { generateArchitecture } from './model-generator.mjs';
import {
  expandedAt,
  groupInteractions,
  isVisible,
  projectedEdges,
} from '../src/ui/view.mjs';

const model = JSON.parse(
  fs.readFileSync(new URL('../models/rendering.json', import.meta.url), 'utf8'),
);
const layout = await buildLayout(model),
  graph = Graph.validate(model);
const intersects = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.001 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.001;

test('inspector groups shared exchanges without losing contracts or conflating peers and channels', () => {
  const inputs = model.relations.filter((edge) =>
    ['query-input', 'ranking-input'].includes(edge.key),
  );
  assert.notEqual(inputs[0].payload, inputs[1].payload);
  for (const incoming of [true, false]) {
    const edges = incoming
      ? inputs
      : inputs.map((edge) => ({ ...edge, from: edge.to, to: edge.from }));
    const before = structuredClone(edges);
    const groups = groupInteractions(edges, incoming);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].relations, edges);
    for (const field of [
      incoming ? 'from' : 'to',
      'label',
      'kind',
      'channel',
    ]) {
      const distinct = {
        ...edges[0],
        key: 'distinct',
        [field]: edges[0][field] + '-other',
      };
      const result = groupInteractions([...edges, distinct], incoming);
      assert.equal(result.length, 2, field);
      assert.deepEqual(
        result.flatMap((group) => group.relations),
        [...edges, distinct],
      );
    }
    const anotherContract = {
      ...edges[0],
      key: 'another-contract',
      payload: edges[1].payload,
    };
    const sameEndpoints = groupInteractions(
      [...edges, anotherContract],
      incoming,
    );
    assert.equal(sameEndpoints.length, 1);
    assert.equal(sameEndpoints[0].relations[2], anotherContract);
    assert.deepEqual(edges, before);
  }
  assert.deepEqual(groupInteractions([]), []);
});

test('ELK geometry covers the model without overlapping siblings or escaping parents', () => {
  assert.deepEqual(checkLayout(model, layout), []);
  const nodes = Object.values(layout.nodes);
  for (const a of nodes)
    for (const b of nodes)
      if (a.key !== b.key && a.parent === b.parent)
        assert(!intersects(a, b), a.key + '/' + b.key);
});

test('rebuilding the same model preserves positions and routes', async () => {
  const rebuilt = await buildLayout(model, { cached: false });
  assert.notEqual(rebuilt, layout);
  assert.deepEqual(rebuilt, layout);
});

test('every semantic zoom uses original relations, visible endpoints, and fixed geometry', () => {
  const before = JSON.stringify(layout);
  for (const width of [390, 1440])
    for (const zoom of [0.1, 0.55, 1.3, 2.5, 4, 7.5, 15, 23, 70, 160]) {
      const expanded = expandedAt(layout, zoom, { width, height: 924 });
      {
        const edges = projectedEdges(model, graph, layout, expanded);
        for (const edge of edges) {
          assert(isVisible(edge.bundle.from, graph, expanded));
          assert(isVisible(edge.bundle.to, graph, expanded));
          assert(
            edge.bundle.relations.every((r) => model.relations.includes(r)),
          );
          assert(
            edge.paths.every((path) => !/NaN|undefined|Infinity/.test(path)),
          );
        }
        for (const node of graph.nodes.values())
          if (
            isVisible(node.key, graph, expanded) &&
            !(node.children && expanded.has(node.key))
          )
            assert(
              edges.some(
                (e) => e.bundle.from === node.key || e.bundle.to === node.key,
              ),
              node.key,
            );
      }
    }
  assert.equal(JSON.stringify(layout), before);
});

test('descendant connectors stay outside unrelated sibling boxes', () => {
  for (const [id, connector] of Object.entries(layout.connectors)) {
    const [, branch, endpoint] = id.split('/');
    const forbidden = [];
    let current = endpoint;
    while (current !== branch) {
      const parent = graph.parents.get(current);
      forbidden.push(
        ...Object.values(layout.nodes).filter(
          (n) => n.parent === parent && n.key !== current,
        ),
      );
      current = parent;
    }
    for (let i = 1; i < connector.points.length; i++) {
      const a = connector.points[i - 1],
        b = connector.points[i];
      assert(Math.abs(a.x - b.x) < 0.001 || Math.abs(a.y - b.y) < 0.001);
      for (const n of forbidden) {
        const hit =
          a.x === b.x
            ? a.x > n.x + 0.001 &&
              a.x < n.x + n.width - 0.001 &&
              Math.max(a.y, b.y) > n.y + 0.001 &&
              Math.min(a.y, b.y) < n.y + n.height - 0.001
            : a.y > n.y + 0.001 &&
              a.y < n.y + n.height - 0.001 &&
              Math.max(a.x, b.x) > n.x + 0.001 &&
              Math.min(a.x, b.x) < n.x + n.width - 0.001;
        assert(!hit, id + '/' + n.key);
      }
    }
  }
});

test('an unchanged model reuses its computed geometry and a changed one does not', async () => {
  assert.equal(await buildLayout(structuredClone(model)), layout);
  const changed = structuredClone(model);
  changed.nodes.at(-1).key = changed.nodes.at(-1).key + '-moved';
  for (const relation of changed.relations)
    for (const side of ['from', 'to'])
      if (relation[side] === model.nodes.at(-1).key)
        relation[side] = changed.nodes.at(-1).key;
  const other = await buildLayout(changed);
  assert.notEqual(other, layout);
  assert.deepEqual(checkLayout(changed, other), []);
});

test('repeated topology reuses geometry without conflating model identities or changed edges', async () => {
  const repeated = generateArchitecture(24, { groups: 4, fanOut: 2 });
  // One group differs while the other three still have the same local graph.
  repeated.relations = repeated.relations.filter(
    (edge) => edge.key !== 'call-1-0-1',
  );
  const reused = await buildLayout(repeated);
  const uncached = await buildLayout(repeated, { cached: false });
  assert.equal(reused.layoutPasses, 3);
  assert.equal(uncached.layoutPasses, 5);
  const { layoutPasses: reusedPasses, ...reusedGeometry } = reused;
  const { layoutPasses: uncachedPasses, ...uncachedGeometry } = uncached;
  assert(reusedPasses < uncachedPasses);
  assert.deepEqual(reusedGeometry, uncachedGeometry);
  assert.deepEqual(checkLayout(repeated, reused), []);
});

test('the reported layout engine version is the installed one', () => {
  const installed = JSON.parse(
    fs.readFileSync(
      new URL('../node_modules/elkjs/package.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(layout.engine, 'elkjs');
  assert.equal(layout.version, installed.version);
});

// A browser Worker over node:worker_threads, so the suite exercises the very
// module a browser loads instead of a stand-in for its message protocol.
const spawned = [];
const host = (url) =>
  new URL(
    'data:text/javascript,' +
      encodeURIComponent(
        [
          "import { parentPort } from 'node:worker_threads';",
          'globalThis.self = {',
          '  addEventListener: (type, handler) =>',
          "    parentPort.on('message', (data) => handler({ data })),",
          '  postMessage: (message) => parentPort.postMessage(message),',
          '};',
          'await import(' + JSON.stringify(String(url)) + ');',
        ].join('\n'),
      ),
  );

class ThreadWorker {
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.terminated = false;
    this.handlers = new Map();
    this.thread = new NodeWorker(host(url));
    this.thread.on('message', (data) => this.emit('message', { data }));
    this.thread.on('error', (error) =>
      this.emit('error', { message: error.message }),
    );
    spawned.push(this);
  }
  emit(type, event) {
    for (const handler of this.handlers.get(type) || []) handler(event);
  }
  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }
  postMessage(message) {
    this.thread.postMessage(message);
  }
  terminate() {
    this.terminated = true;
    this.thread.terminate();
  }
}

// A worker that starts and then dies, the way an out-of-memory or blocked-import
// one does: the map still has to get its geometry.
class DyingWorker extends ThreadWorker {
  constructor(url, options) {
    super(url, options);
    this.thread.terminate();
  }
  postMessage() {
    queueMicrotask(() => this.emit('error', { message: 'WORKER_DIED' }));
  }
}

const usingWorker = async (constructor, run) => {
  const present = 'Worker' in globalThis;
  const before = globalThis.Worker;
  globalThis.Worker = constructor;
  try {
    return await run();
  } finally {
    if (present) globalThis.Worker = before;
    else delete globalThis.Worker;
  }
};

const untilSpawned = async () => {
  const deadline = Date.now() + 5000;
  while (!spawned.length) {
    if (Date.now() > deadline) throw new Error('WORKER_NEVER_SPAWNED');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return spawned.at(-1);
};

test('geometry is computed off the main thread and the worker is stopped after it', async () => {
  spawned.length = 0;
  const offThread = await usingWorker(ThreadWorker, () =>
    buildLayout(model, { cached: false }),
  );
  assert.equal(spawned.length, 1);
  assert.match(spawned[0].url, /layout\/layout-worker\.mjs$/);
  assert.equal(spawned[0].options?.type, 'module');
  assert.equal(spawned[0].terminated, true);
  assert.deepEqual(offThread, layout);
  assert.deepEqual(checkLayout(model, offThread), []);
});

test('a platform without a worker, one that refuses it, and one whose worker dies all still lay out', async () => {
  assert.equal('Worker' in globalThis, false);
  assert.deepEqual(await buildLayout(model, { cached: false }), layout);
  const refused = await usingWorker(
    class {
      constructor() {
        throw new DOMException('blocked by policy', 'SecurityError');
      }
    },
    () => buildLayout(model, { cached: false }),
  );
  assert.deepEqual(refused, layout);
  spawned.length = 0;
  const died = await usingWorker(DyingWorker, () =>
    buildLayout(model, { cached: false }),
  );
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].terminated, true);
  assert.deepEqual(died, layout);
});

test('a withdrawn layout stops its worker, rejects with the reason and leaves the last geometry in place', async () => {
  const withdrawn = structuredClone(model);
  const last = withdrawn.nodes.at(-1);
  const renamed = last.key + '-withdrawn';
  for (const relation of withdrawn.relations)
    for (const side of ['from', 'to'])
      if (relation[side] === last.key) relation[side] = renamed;
  last.key = renamed;
  spawned.length = 0;
  const controller = new AbortController();
  const reason = new DOMException('LOAD_SUPERSEDED', 'AbortError');
  const superseded = usingWorker(ThreadWorker, async () => {
    const pending = buildLayout(withdrawn, { signal: controller.signal });
    await untilSpawned();
    controller.abort(reason);
    return pending;
  });
  await assert.rejects(superseded, (error) => error === reason);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].terminated, true);
  // The map keeps painting what it already had, and the layout it never finished
  // is not left half-built for the next caller either.
  assert.equal(await buildLayout(model), layout);
  assert.deepEqual(checkLayout(withdrawn, await buildLayout(withdrawn)), []);
});
