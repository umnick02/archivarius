import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url).pathname;
const consumer = path.join(root, '.runtime/consumer');
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
await fs.mkdir(path.join(root, '.runtime/pack'), { recursive: true });
const [pack] = JSON.parse(
  run('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    '.runtime/pack',
  ]),
);
assert(pack.files.some((file) => file.path === 'dist/src/index.js'));
assert(
  pack.files.some((file) => file.path === 'dist/assets/model.schema.json'),
);
assert(
  pack.files.some((file) => file.path === 'LICENSE'),
  'the licence must ship',
);
assert(
  pack.files.every((file) =>
    /^(dist\/|README.md$|LICENSE$|package.json$)/.test(file.path),
  ),
);
await fs.mkdir(consumer, { recursive: true });
await fs.cp(path.join(root, 'tests/consumer'), consumer, { recursive: true });
await fs.mkdir(path.join(consumer, 'public'), { recursive: true });
await fs.copyFile(
  path.join(root, 'models/rendering.json'),
  path.join(consumer, 'public/architecture.json'),
);
await fs.copyFile(
  path.join(root, 'models/documentation.json'),
  path.join(consumer, 'public/project.json'),
);
const pkg = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8'),
);
await fs.writeFile(
  path.join(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'archivarius-consumer',
      private: true,
      type: 'module',
      dependencies: {
        archivarius: 'file:../pack/' + pack.filename,
        react: pkg.devDependencies.react,
        'react-dom': pkg.devDependencies['react-dom'],
      },
      devDependencies: Object.fromEntries(
        ['vite', 'typescript', '@types/react', '@types/react-dom'].map(
          (key) => [key, pkg.devDependencies[key]],
        ),
      ),
    },
    null,
    2,
  ),
);
// Remove the installed tarball copy so a repeated check cannot reuse old bytes.
await fs.rm(path.join(consumer, 'node_modules/archivarius'), {
  recursive: true,
  force: true,
});
await fs.rm(path.join(consumer, 'package-lock.json'), { force: true });
run('npm', ['install', '--ignore-scripts'], consumer);
const installed = JSON.parse(
  await fs.readFile(
    path.join(consumer, 'node_modules/archivarius/package.json'),
    'utf8',
  ),
);
assert.match(
  installed.license ?? '',
  /^[A-Za-z0-9][A-Za-z0-9.+-]*$/,
  'the installed package must declare an SPDX licence',
);
assert.notEqual(installed.license, 'UNLICENSED');
run('node', ['node_modules/typescript/bin/tsc'], consumer);
const cli = path.join(consumer, 'node_modules/.bin/archivarius');
assert.equal(
  JSON.parse(
    run(cli, ['validate', 'public/architecture.json', '--json'], consumer),
  ).valid,
  true,
);
run(
  cli,
  ['reference', 'public/architecture.json', '--output', 'architecture.md'],
  consumer,
);
run(
  cli,
  [
    'reference',
    'public/architecture.json',
    '--output',
    'architecture.md',
    '--check',
  ],
  consumer,
);
for (const shipped of [
  'dist/assets/authoring.md',
  'dist/assets/contract.md',
  'dist/assets/public-surface.json',
])
  assert(
    pack.files.some((file) => file.path === shipped),
    shipped,
  );
// The promise ships with the package, so the tarball is held to it: every module,
// declaration, file and asset the surface names has to be in the bytes a consumer
// installs, and the binary it names has to be the one package.json points at.
const surface = JSON.parse(
  await fs.readFile(path.join(root, 'assets/public-surface.json'), 'utf8'),
);
const packed = new Set(pack.files.map((file) => file.path));
const promised = [
  ...surface.entryPoints.flatMap((entry) => [entry.module, entry.types]),
  ...surface.files
    .map((file) => file.path)
    .filter((file) => !file.endsWith('assets')),
  ...surface.files.flatMap((file) =>
    (file.assets ?? []).map((name) => 'dist/assets/' + name),
  ),
  ...surface.binaries.map((binary) => binary.path),
];
for (const file of promised)
  assert(
    packed.has(file),
    file + ' is promised by the public surface and is not packed',
  );
for (const binary of surface.binaries)
  assert.equal(installed.bin[binary.name], './' + binary.path, binary.name);
assert(
  !pack.files.some((file) => file.path.endsWith('AGENTS.md')),
  'agent instructions must not ship',
);
assert(pack.files.some((file) => file.path === 'dist/example.json'));
run('node', ['node_modules/vite/bin/vite.js', 'build'], consumer);
const files = await fs.readdir(path.join(consumer, 'dist/assets'));
assert(
  files.some((file) => file.startsWith('strings-') && file.endsWith('.json')),
);
assert(
  files.some((file) => file.startsWith('contracts-') && file.endsWith('.json')),
);
const scripts = (
  await Promise.all(
    files
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFile(path.join(consumer, 'dist/assets', f), 'utf8')),
  )
).join('\n');
const model = JSON.parse(
  await fs.readFile(path.join(consumer, 'public/architecture.json'), 'utf8'),
);
const copy = JSON.parse(
  await fs.readFile(path.join(root, 'assets/strings.json'), 'utf8'),
);
assert(!scripts.includes(model.nodes[0].title));
assert(!scripts.includes(copy.interpretationNote));
console.log(
  'PASS: installed tarball, exported types, nested production base path, separate JSON assets.',
);
