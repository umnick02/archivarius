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
  pack.files.every((file) =>
    /^(dist\/|README.md$|package.json$)/.test(file.path),
  ),
);
await fs.mkdir(consumer, { recursive: true });
await fs.cp(path.join(root, 'tests/consumer'), consumer, { recursive: true });
await fs.mkdir(path.join(consumer, 'public'), { recursive: true });
await fs.copyFile(
  path.join(root, 'examples/basic/public/architecture.json'),
  path.join(consumer, 'public/architecture.json'),
);
await fs.copyFile(
  path.join(root, 'examples/basic/public/project.json'),
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
  ['docs', 'public/architecture.json', '--output', 'architecture.md'],
  consumer,
);
run(
  cli,
  [
    'docs',
    'public/architecture.json',
    '--output',
    'architecture.md',
    '--check',
  ],
  consumer,
);
assert(pack.files.some((file) => file.path === 'dist/assets/authoring.md'));
assert(pack.files.some((file) => file.path === 'dist/example.json'));
run('node', ['node_modules/vite/bin/vite.js', 'build'], consumer);
const files = await fs.readdir(path.join(consumer, 'dist/assets'));
assert(files.some((file) => file.startsWith('ru-') && file.endsWith('.json')));
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
  await fs.readFile(path.join(root, 'assets/ru.json'), 'utf8'),
);
assert(!scripts.includes(model.nodes[0].title));
assert(!scripts.includes(copy.interpretationNote));
console.log(
  'PASS: installed tarball, exported types, nested production base path, separate JSON assets.',
);
