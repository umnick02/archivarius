// The folders in src/ name layers, so the import graph must stay a DAG that only
// ever points downward. ESLint guards node:*/process and reaching into io/; this
// suite guards the direction and the absence of cycles, which no rule can see.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../src/', import.meta.url);

// A layer may import the layers listed for it and nothing else in src/. Only the
// root entry points may import a layer, so no layer lists 'root': a module reaches
// its owner directly, never through an export surface.
const allowed = {
  root: ['root', 'ui', 'model', 'io', 'layout', 'generated'],
  ui: ['ui', 'model', 'layout'],
  model: ['model', 'generated'],
  io: ['io', 'model'],
  layout: ['layout', 'model'],
  generated: ['generated'],
};

const layerOf = (file) => (file.includes('/') ? file.split('/')[0] : 'root');

async function importGraph() {
  const graph = new Map();
  for (const file of await fs.readdir(root, { recursive: true })) {
    if (!/\.(?:mjs|jsx)$/.test(file)) continue;
    const source = await fs.readFile(new URL(file, root), 'utf8');
    const targets = [];
    for (const match of source.matchAll(
      /(?:from|import)\s*\(?\s*'(\.[^']+)'/g,
    )) {
      const resolved = new URL(match[1], new URL(file, root)).pathname;
      targets.push(resolved.slice(root.pathname.length));
    }
    graph.set(file, targets);
  }
  return graph;
}

test('every import points down the layers the folders name', async () => {
  const graph = await importGraph();
  const violations = [];
  for (const [file, targets] of graph)
    for (const target of targets) {
      const source = layerOf(file);
      if (!allowed[source].includes(layerOf(target)))
        violations.push(`${file} -> ${target}`);
    }
  assert.deepEqual(violations, []);
});

test('the import graph has no cycles', async () => {
  const graph = await importGraph();
  const state = new Map();
  const cycles = [];
  const walk = (file, stack) => {
    if (state.get(file) === 'open') {
      cycles.push(stack.slice(stack.indexOf(file)).join(' -> '));
      return;
    }
    if (state.get(file) === 'done') return;
    state.set(file, 'open');
    for (const target of graph.get(file) ?? [])
      walk(target, [...stack, target]);
    state.set(file, 'done');
  };
  for (const file of graph.keys()) walk(file, [file]);
  assert.deepEqual(cycles, []);
});
