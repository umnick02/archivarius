// Record the promise a version makes.
//
// `assets/public-surface.json` is what `tests/surface.test.mjs` holds the built
// package to: the named exports of every published subpath, the files and assets
// that ship, the binary, and the shape of every contract a consumer writes
// against. This script reads all of that out of the built package and the shipped
// schemas and writes it down, with the release policy of each entry kept beside it.
//
// Run it after a release changes the surface on purpose — `npm run build` first,
// then `node tooling/record-surface.mjs`. Inside a major, a breaking difference is
// a failing test, not a file to re-record.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { contractShape } from '../src/model/contract.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async (file) =>
  JSON.parse(await fs.readFile(new URL(file, root), 'utf8'));

// Export names are read from the built module without running it: a browser entry
// cannot be imported in Node, and a promise is about names, not about a runtime.
const exportsOf = async (file) => {
  const bundled = await build({
    entryPoints: [new URL(file, root).pathname],
    bundle: false,
    write: false,
    metafile: true,
    outdir: 'exports',
    format: 'esm',
    logLevel: 'silent',
  });
  return Object.values(bundled.metafile.outputs)
    .flatMap((output) => output.exports)
    .sort();
};

const modules = [
  {
    subpath: '.',
    module: 'dist/src/index.js',
    types: 'dist/src/index.d.ts',
    minor: 'May gain a named export or an optional option on one.',
    major:
      'May remove or rename an export, or change what one requires or returns.',
  },
  {
    subpath: './core',
    module: 'dist/src/core.mjs',
    types: 'dist/src/core.d.mts',
    minor: 'May gain a named export, a failure code or an optional option.',
    major: 'May remove or rename an export, or narrow what one accepts.',
  },
  {
    subpath: './node',
    module: 'dist/src/node.mjs',
    types: 'dist/src/node.d.mts',
    minor: 'May gain a named export or an optional option on one.',
    major:
      'May remove or rename an export, or change the files one reads or writes.',
  },
];

const schemas = [
  {
    name: 'model.schema.json',
    minor: 'May gain an optional field, a value in an enum or a looser bound.',
    major:
      'May remove a field, require one it did not, withdraw a value, tighten a bound or raise the contract version.',
  },
  {
    name: 'architecture.schema.json',
    minor: 'May gain an optional field, a value in an enum or a looser bound.',
    major:
      'May remove a field, require one it did not, withdraw a value, tighten a bound or raise the contract version.',
  },
  {
    name: 'change.schema.json',
    minor: 'May gain an optional field or a value in an enum.',
    major: 'May remove a field, require one it did not, or withdraw a value.',
  },
];

const pkg = await readJSON('package.json');
const assets = (await fs.readdir(new URL('dist/assets/', root))).sort();
if (!assets.includes('public-surface.json')) {
  assets.push('public-surface.json');
  assets.sort();
}

const entryPoints = [];
for (const entry of modules)
  entryPoints.push({ ...entry, exports: await exportsOf(entry.module) });

const contracts = [];
for (const { name, minor, major } of schemas) {
  const shape = contractShape(await readJSON('assets/' + name));
  contracts.push({
    subpath: './assets/' + name,
    path: 'assets/' + name,
    title: shape.title,
    version: shape.version,
    minor,
    major,
    shape: shape.locations,
  });
}

const surface = {
  surface: 1,
  release: pkg.version,
  note: 'What this package promises: the named exports of every published subpath, the files and assets that ship, and the fields, values and bounds of every contract a consumer writes against. A minor release may only add to what is listed here; only a release that raises the major may remove, rename, require or tighten anything. The recorded contract shapes are also the previous contract - a release grades the shipped schemas against them with gradeContract. Re-record with npm run build && node tooling/record-surface.mjs.',
  entryPoints,
  files: [
    {
      subpath: './example.json',
      path: 'dist/example.json',
      minor: 'May gain records, and its own contract may change additively.',
      major:
        'May be removed, renamed or written against a newer contract major.',
    },
    {
      subpath: './style.css',
      path: 'dist/style.css',
      minor: 'May gain rules under the .archivarius scope.',
      major:
        'May remove a class a host styled, or leave the .archivarius scope.',
    },
    {
      subpath: './model.schema.json',
      path: 'dist/assets/model.schema.json',
      minor: 'May change additively; the subpath stays.',
      major: 'May be removed or point at a different contract.',
    },
    {
      subpath: './assets/*',
      path: 'dist/assets',
      assets,
      minor: 'May gain an asset file.',
      major: 'May remove or rename an asset file.',
    },
  ],
  binaries: [
    {
      name: 'archivarius',
      path: 'dist/src/cli.mjs',
      minor: 'May gain a command, an option or a line of output.',
      major:
        'May remove or rename a command or an option, or change the shape of its JSON output.',
    },
  ],
  contracts,
};

const file = 'assets/public-surface.json';
await fs.writeFile(
  new URL(file, root),
  JSON.stringify(surface, null, 2) + '\n',
);
// The recorded file is repository source, so it is left formatted the way every
// other file is: a recording must never be the reason format:check fails.
execFileSync('npx', ['prettier', '--write', file], {
  cwd: path.dirname(new URL('package.json', root).pathname),
  stdio: ['ignore', 'ignore', 'inherit'],
});
console.log('Recorded ' + file + ' for ' + pkg.version + '.');
