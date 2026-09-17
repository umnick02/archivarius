// A digest proves a file has not moved, not that it still does what a record
// claims. The dependency a module really has is readable from its text, so this
// suite pins what the scanner sees — and, just as important, the traps it must
// not fall into: a specifier that only looks like one because it sits in a
// string, a comment, a template or the middle of a longer word.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readImports, observeImports } from '../src/model/imports.mjs';

const targets = (text, path = 'src/model/subject.mjs') =>
  readImports(text, path).map((entry) => entry.target);

test('a static import resolves its relative specifier against the module path', () => {
  assert.deepEqual(
    readImports("import { index } from './records.mjs';\n", 'src/model/a.mjs'),
    [
      {
        specifier: './records.mjs',
        target: 'src/model/records.mjs',
        bare: false,
        form: 'static',
      },
    ],
  );
});

test('a parent specifier climbs out of the folder it is written in', () => {
  assert.deepEqual(targets("import prose from '../generated/prose.mjs';"), [
    'src/generated/prose.mjs',
  ]);
});

test('a bare specifier is left as the package name it is', () => {
  assert.deepEqual(
    readImports(
      "import React from 'react';\nimport fs from 'node:fs';",
      'x.mjs',
    ),
    [
      { specifier: 'react', target: 'react', bare: true, form: 'static' },
      { specifier: 'node:fs', target: 'node:fs', bare: true, form: 'static' },
    ],
  );
});

test('every import clause form reaches its specifier', () => {
  assert.deepEqual(
    targets(
      [
        "import './side.mjs';",
        "import one from './one.mjs';",
        "import { a, b as c } from './two.mjs';",
        "import * as all from './three.mjs';",
        "import four, { five } from './four.mjs';",
      ].join('\n'),
    ),
    [
      'src/model/side.mjs',
      'src/model/one.mjs',
      'src/model/two.mjs',
      'src/model/three.mjs',
      'src/model/four.mjs',
    ],
  );
});

test('a republished export is an import of the module behind it', () => {
  assert.deepEqual(
    readImports(
      ["export * from './all.mjs';", "export { one } from './one.mjs';"].join(
        '\n',
      ),
      'src/model/a.mjs',
    ).map((entry) => [entry.form, entry.target]),
    [
      ['export', 'src/model/all.mjs'],
      ['export', 'src/model/one.mjs'],
    ],
  );
});

test('an export that republishes nothing is not an import', () => {
  assert.deepEqual(
    targets(
      [
        'export const from = 1;',
        'export function f() { return from; }',
        'export { f };',
      ].join('\n'),
    ),
    [],
  );
});

test('a dynamic import with a literal specifier is an edge', () => {
  assert.deepEqual(
    readImports(
      "const m = await import('./layout/elk.mjs');",
      'src/ui/load.mjs',
    ).map((entry) => [entry.form, entry.target]),
    [['dynamic', 'src/ui/layout/elk.mjs']],
  );
});

test('a dynamic import of a computed specifier is not an edge', () => {
  assert.deepEqual(targets('const m = await import(name);'), []);
});

test('import.meta is not an import', () => {
  assert.deepEqual(targets("const url = import.meta.url + './x.mjs';"), []);
});

// The traps. Each of these carries text that reads like an import and must not
// become an edge, beside one real import that proves the scanner kept going.
test('a specifier inside a string literal is not an import', () => {
  assert.deepEqual(
    targets(
      [
        'const pattern = "import x from \'./ghost.mjs\'";',
        'const other = \'export * from "./ghost.mjs"\';',
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a specifier inside a line comment is not an import', () => {
  assert.deepEqual(
    targets(
      [
        "// import ghost from './ghost.mjs';",
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a specifier inside a block comment is not an import', () => {
  assert.deepEqual(
    targets(
      [
        '/* import ghost from "./ghost.mjs";',
        "   export * from './ghost.mjs'; */",
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a specifier inside a template literal is not an import', () => {
  assert.deepEqual(
    targets(
      [
        'const message = `import ghost from "./ghost.mjs"`;',
        'const built = `import ${name} from "./ghost.mjs"`;',
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a dynamic import written with a template specifier is read when it holds no substitution', () => {
  assert.deepEqual(targets('await import(`./one.mjs`);'), [
    'src/model/one.mjs',
  ]);
});

test('a dynamic import of an interpolated template is not an edge', () => {
  assert.deepEqual(targets('await import(`./${name}.mjs`);'), []);
});

test('import as part of a longer identifier is not an import', () => {
  assert.deepEqual(
    targets(
      [
        "const important = 'yes';",
        'const unimportant = important;',
        'const o = { imports: 1 };',
        'function importer() { return o.imports; }',
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a specifier inside a regular expression literal is not an import', () => {
  assert.deepEqual(
    targets(
      [
        "const rx = /import .* from '\\.\\/ghost\\.mjs'/g;",
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('division is not mistaken for a regular expression', () => {
  assert.deepEqual(
    targets(
      ['const half = (a) => a / 2;', "import real from './real.mjs';"].join(
        '\n',
      ),
    ),
    ['src/model/real.mjs'],
  );
});

test('an escaped quote inside a specifier-looking string does not end it', () => {
  assert.deepEqual(
    targets(
      [
        "const text = 'it\\'s not import from \"./ghost.mjs\"';",
        "import real from './real.mjs';",
      ].join('\n'),
    ),
    ['src/model/real.mjs'],
  );
});

test('a specifier with no extension resolves to the path as written', () => {
  assert.deepEqual(targets("import x from './sibling';"), [
    'src/model/sibling',
  ]);
});

test('a same-directory specifier written with a dot segment collapses', () => {
  assert.deepEqual(
    targets("import x from './deep/../near.mjs';", 'src/model/a.mjs'),
    ['src/model/near.mjs'],
  );
});

test('a module with no imports observes no edge', () => {
  assert.deepEqual(targets('export const one = 1;\n'), []);
});

test('observing a set of modules yields one edge per distinct dependency', () => {
  assert.deepEqual(
    observeImports([
      {
        path: 'src/core.mjs',
        text: [
          "export * from './model/parse.mjs';",
          "import { parse } from './model/parse.mjs';",
          "import x from 'ajv';",
        ].join('\n'),
      },
      { path: 'src/model/parse.mjs', text: "import './graph.mjs';" },
    ]),
    [
      { from: 'src/core.mjs', to: 'src/model/parse.mjs' },
      { from: 'src/core.mjs', to: 'ajv' },
      { from: 'src/model/parse.mjs', to: 'src/model/graph.mjs' },
    ],
  );
});

// The oracle: the scanner has to read this repository's own modules. Every
// relative specifier in src/ names a file that is really there, and the layer
// direction the folders name holds for the edges the scanner sees.
const layers = {
  root: ['root', 'ui', 'model', 'io', 'layout', 'generated'],
  ui: ['ui', 'model', 'layout'],
  model: ['model', 'generated'],
  io: ['io', 'model'],
  layout: ['layout', 'model'],
  generated: ['generated'],
};

const layerOf = (file) => {
  const rest = file.slice('src/'.length);
  return rest.includes('/') ? rest.split('/')[0] : 'root';
};

async function sourceModules() {
  const root = new URL('../src/', import.meta.url);
  const modules = [];
  for (const file of await fs.readdir(root, { recursive: true })) {
    if (!/\.(?:mjs|jsx)$/.test(file)) continue;
    modules.push({
      path: 'src/' + file,
      text: await fs.readFile(new URL(file, root), 'utf8'),
    });
  }
  return modules;
}

test('every relative specifier in src/ names a file that exists', async () => {
  const modules = await sourceModules();
  const present = new Set(modules.map((module) => module.path));
  const missing = [];
  for (const module of modules)
    for (const entry of readImports(module.text, module.path))
      if (!entry.bare && !present.has(entry.target))
        missing.push(module.path + ' -> ' + entry.specifier);
  assert.deepEqual(missing, []);
});

test('the edges the scanner sees in src/ point down the layers the folders name', async () => {
  const edges = observeImports(await sourceModules());
  const relative = edges.filter((edge) => edge.to.startsWith('src/'));
  assert.ok(relative.length > 40, 'the scanner found almost no dependency');
  assert.deepEqual(
    relative
      .filter((edge) => !layers[layerOf(edge.from)].includes(layerOf(edge.to)))
      .map((edge) => edge.from + ' -> ' + edge.to),
    [],
  );
});
