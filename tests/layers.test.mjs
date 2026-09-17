// The folders in src/ name layers, so the import graph must stay a DAG that only
// ever points downward. ESLint guards node:*/process and reaching into io/; this
// suite guards the direction and the absence of cycles, which no rule can see.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProjectFiles } from '../src/node.mjs';

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

// The other half of the boundary: which modules may touch the world. ESLint states
// it as a rule, and a rule can be disabled in the file it governs, so the same
// boundary is read here from the bytes - one command can then answer for the whole
// criterion.
const worldly = {
  file: /(?:from\s*'node:|import\s*\(\s*'node:|\bprocess\.)/,
  network: /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,
};

test('only the modules that own the world touch it', async () => {
  // src/io/ and the two entry points do file access; src/ui/load.mjs is the one
  // module that fetches a model, so a component cannot grow its own request.
  const owners = {
    file: (file) =>
      file.startsWith('io/') || file === 'node.mjs' || file === 'cli.mjs',
    network: (file) => file === 'ui/load.mjs',
  };
  const trespasses = [];
  for (const file of await fs.readdir(root, { recursive: true })) {
    if (!/\.(?:mjs|jsx)$/.test(file)) continue;
    if (file.startsWith('generated/')) continue;
    const source = await fs.readFile(new URL(file, root), 'utf8');
    for (const [world, pattern] of Object.entries(worldly))
      if (pattern.test(source) && !owners[world](file))
        trespasses.push(`${file} -> ${world}`);
  }
  assert.deepEqual(trespasses, []);
});

// The reading is only worth something if it can see a trespass at all.
test('a module that reaches for the world is seen reaching', () => {
  assert.match("import fs from 'node:fs';", worldly.file);
  assert.match('const answer = await fetch(url);', worldly.network);
  assert.doesNotMatch(
    "import { parse } from './model/parse.mjs';",
    worldly.file,
  );
  assert.doesNotMatch('const prefetched = cache.get(url);', worldly.network);
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
// The description read against the code. This used to be a second, weaker walk of
// the import graph spelled here; it is now the shipped reconciliation, so the
// repository is held to the same reading it offers a consumer. `reconcile` runs in
// the gate too - this oracle is the one that fails inside the test suite.
test('every described interaction is a dependency this repository really has', async () => {
  const report = await reconcileProjectFiles(
    new URL('../project.json', import.meta.url).pathname,
    new URL('../', import.meta.url).pathname,
  );
  assert.ok(report.confirmed.length, 'no described interaction was confirmed');
  assert.deepEqual(
    report.absent.map(
      (entry) => entry.relation + ': ' + entry.from + ' -> ' + entry.to,
    ),
    [],
    'the model draws an edge the modules do not have',
  );
  assert.deepEqual(
    report.undeclared.map((entry) => entry.from + ' -> ' + entry.to),
    [],
    'the modules have a dependency the model does not declare',
  );
});
