// The folders in src/ name layers, so the import graph must stay a DAG that only
// ever points downward. ESLint guards node:*/process and reaching into io/; this
// suite guards the direction and the absence of cycles, which no rule can see.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { files } from '../docs/scripts/bind.mjs';

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

async function graphOf(pattern) {
  const graph = new Map();
  for (const file of await fs.readdir(root, { recursive: true })) {
    if (!/\.(?:mjs|jsx)$/.test(file)) continue;
    const source = await fs.readFile(new URL(file, root), 'utf8');
    const targets = [];
    for (const match of source.matchAll(pattern)) {
      const resolved = new URL(match[1], new URL(file, root)).pathname;
      targets.push(resolved.slice(root.pathname.length));
    }
    graph.set(file, targets);
  }
  return graph;
}

const importGraph = () => graphOf(/(?:from|import)\s*\(?\s*'(\.[^']+)'/g);

// What a module republishes belongs to it, so a barrel answers for the modules
// behind it.
const republishGraph = () => graphOf(/export[^;]*?from\s+'(\.[^']+)'/g);

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

// Prose about an interaction is only an assertion, but the edge it draws is a
// dependency, and a dependency is a fact this repository already carries. An
// interaction between two modules holds when the source reaches the target's own
// export surface; the surface stops at any file another described part owns, so a
// barrel never lends its identity to its neighbours.
test('every described interaction is a dependency this repository really has', async () => {
  const project = JSON.parse(
    await fs.readFile(new URL('../project.json', import.meta.url), 'utf8'),
  );
  const imports = await importGraph();
  const republished = await republishGraph();
  const module = (key) =>
    files[key]?.startsWith('src/') ? files[key].slice('src/'.length) : null;
  const surface = (key) => {
    const owned = new Set(
      Object.entries(files)
        .filter(([other]) => other !== key)
        .map(([, file]) => file),
    );
    const reached = new Set();
    const walk = (file) => {
      if (reached.has(file)) return;
      reached.add(file);
      for (const next of republished.get(file) ?? [])
        if (!owned.has('src/' + next)) walk(next);
    };
    walk(module(key));
    return reached;
  };
  const reaches = (file, targets, seen = new Set()) => {
    if (targets.has(file)) return true;
    if (seen.has(file)) return false;
    seen.add(file);
    return (imports.get(file) ?? []).some((next) =>
      reaches(next, targets, seen),
    );
  };
  const edges = project.records.filter(
    (record) =>
      record.type === 'interaction' && module(record.from) && module(record.to),
  );
  assert.ok(edges.length, 'no described interaction connects two modules');
  assert.deepEqual(
    edges
      .filter((record) => !reaches(module(record.from), surface(record.to)))
      .map((record) => `${record.key}: ${record.from} -> ${record.to}`),
    [],
    'the model draws an edge the modules do not have',
  );
});
