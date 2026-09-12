import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLayout, checkLayout } from '../src/layout/layout.mjs';
import { ArchitectureGraph as Graph } from '../src/graph.mjs';
import {
  expandedAt,
  groupInteractions,
  isVisible,
  projectedEdges,
} from '../src/view.mjs';

const model = JSON.parse(
  fs.readFileSync(
    new URL('../examples/basic/public/architecture.json', import.meta.url),
    'utf8',
  ),
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
  assert.deepEqual(await buildLayout(model), layout);
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
