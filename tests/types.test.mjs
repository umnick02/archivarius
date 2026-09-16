import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const surfaces = [
  ['index.jsx', 'index.d.ts'],
  ['core.mjs', 'core.d.mts'],
  ['node.mjs', 'node.d.mts'],
];
const options = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  jsx: ts.JsxEmit.ReactJSX,
  lib: ['lib.dom.d.ts', 'lib.es2022.d.ts'],
  skipLibCheck: false,
};
const declarations = surfaces.map(
  ([, file]) => new URL('src/' + file, root).pathname,
);

// The hand-written declarations are the shipped contract of every export, so a
// missing, extra or unresolvable one fails here rather than in a consumer.
test('shipped declarations type-check on their own', () => {
  const program = ts.createProgram(declarations, options);
  const diagnostics = ts.getPreEmitDiagnostics(program).map((d) =>
    ts.formatDiagnostic(d, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => root.pathname,
      getNewLine: () => '\n',
    }),
  );
  assert.deepEqual(diagnostics, []);
});

test('declared value exports match the exports of their module', async () => {
  const program = ts.createProgram(declarations, options);
  const checker = program.getTypeChecker();
  for (const [module, file] of surfaces) {
    const source = program.getSourceFile(new URL('src/' + file, root).pathname);
    assert(source, file);
    const declared = new Set(
      checker
        .getExportsOfModule(checker.getSymbolAtLocation(source))
        .filter((symbol) => {
          const target =
            symbol.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(symbol)
              : symbol;
          return target.flags & ts.SymbolFlags.Value;
        })
        .map((symbol) => symbol.getName()),
    );
    const bundled = await build({
      entryPoints: [new URL('src/' + module, root).pathname],
      bundle: false,
      write: false,
      metafile: true,
      outdir: 'exports',
      format: 'esm',
      logLevel: 'silent',
    });
    const exported = new Set(
      Object.values(bundled.metafile.outputs).flatMap(
        (output) => output.exports,
      ),
    );
    assert.deepEqual(
      [...exported].filter((name) => !declared.has(name)),
      [],
      module + ' exports values that ' + file + ' does not declare',
    );
    assert.deepEqual(
      [...declared].filter((name) => !exported.has(name)),
      [],
      file + ' declares values that ' + module + ' does not export',
    );
  }
});

// One export, one owner. The browser entry may republish only the parse surface
// a host needs to feed a map and catch its failures; anything else it shares with
// the validation surface is an arbitrary second front door.
test('the browser entry republishes only what mounting a map needs', async () => {
  const values = async (module) => {
    const bundled = await build({
      entryPoints: [new URL('src/' + module, root).pathname],
      bundle: false,
      write: false,
      metafile: true,
      outdir: 'exports',
      format: 'esm',
      logLevel: 'silent',
    });
    return new Set(
      Object.values(bundled.metafile.outputs).flatMap(
        (output) => output.exports,
      ),
    );
  };
  const core = await values('core.mjs');
  const shared = [...(await values('index.jsx'))]
    .filter((name) => core.has(name))
    .sort();
  assert.deepEqual(shared, [
    'ArchitectureError',
    'parseArchitecture',
    'validateArchitecture',
  ]);
});
