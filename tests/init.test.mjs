// Authoring never starts from an empty file: `init` writes the smallest snapshot
// the shipped contract accepts — one scope, one source, one requirement, one
// criterion — and refuses to write over a snapshot that already exists.
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { initialProject } from '../src/model/init.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { readArchitectureFile } from '../src/node.mjs';

const root = new URL('../', import.meta.url);
const schema = JSON.parse(
  await fs.readFile(
    new URL('assets/archivarius-model.schema.json', root),
    'utf8',
  ),
);
const branch = (type) =>
  schema.$defs.record.oneOf.find((one) => one.properties?.type?.const === type);
const required = (type) =>
  new Set([...schema.$defs.record.required, ...branch(type).required]);

const temporary = async (t, prefix) => {
  const directory = await fs.mkdtemp(new URL('.runtime/' + prefix, root));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};

test('the initial snapshot is the smallest one the shipped contract accepts', () => {
  const model = initialProject();
  const report = validateProject(model);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.valid, true);
  assert.deepEqual(
    model.records.map((record) => record.type),
    ['scope', 'source', 'requirement', 'criterion'],
  );
  const scope = model.records[0];
  assert.equal(model.root, scope.key);
  assert.equal(model.entry, null);
  assert.deepEqual(model.bindings, {});
  assert.deepEqual(model.history, []);
  assert.deepEqual(model.snapshots, []);
  // The criterion states the requirement, which rests on the source, which sits
  // in the scope: the four records are one chain, not four loose claims.
  const [, source, requirement, criterion] = model.records;
  assert.equal(source.scope, scope.key);
  assert.deepEqual(requirement.sources, [source.key]);
  assert.deepEqual(requirement.appliesTo, [scope.key]);
  assert.equal(criterion.requirement, requirement.key);
});

// Optional fields are the contract's to add. A starting point that fills one
// would break the day the contract adds another, so it fills none of them.
test('the initial snapshot fills only the fields the contract requires', () => {
  for (const record of initialProject().records) {
    const needed = required(record.type);
    assert.deepEqual(
      Object.keys(record).filter((field) => !needed.has(field)),
      [],
      record.key + ' fills a field the contract does not require',
    );
    assert.deepEqual(
      [...needed].filter((field) => !Object.hasOwn(record, field)),
      [],
      record.key + ' omits a field the contract requires',
    );
  }
});

test('a stated title is the snapshot title and the whole model stays valid', () => {
  const model = initialProject({ title: 'Ledger export' });
  assert.equal(model.title, 'Ledger export');
  assert.equal(validateProject(model).valid, true);
  assert.equal(initialProject().title, initialProject({}).title);
});

test('init writes a snapshot the node reader accepts', async (t) => {
  const directory = await temporary(t, 'init-write-');
  const file = path.join(directory, 'project.json');
  const printed = execFileSync(
    process.execPath,
    ['src/cli.mjs', 'init', file, '--title', 'Ledger export'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(printed.trim(), file);
  const written = await fs.readFile(file, 'utf8');
  assert.equal(written.endsWith('\n'), true);
  const model = await readArchitectureFile(file);
  assert.equal(model.title, 'Ledger export');
  assert.deepEqual(
    model.records.map((record) => record.type),
    ['scope', 'source', 'requirement', 'criterion'],
  );
  // The written file is the model the pure surface states, byte for byte.
  assert.deepEqual(JSON.parse(written), initialProject({ title: model.title }));
  // The snapshot is immediately readable by the commands an author runs next.
  const read = JSON.parse(
    execFileSync(
      process.execPath,
      ['src/cli.mjs', 'read', file, '--focus', model.root],
      { cwd: root, encoding: 'utf8' },
    ),
  );
  assert.deepEqual(
    read.records.map((record) => record.key),
    ['project', 'owner-request', 'first-requirement'],
  );
});

test('init refuses to write over a file that already exists', async (t) => {
  const directory = await temporary(t, 'init-exists-');
  const file = path.join(directory, 'project.json');
  const existing = '{"version":4,"authored":"by hand"}\n';
  await fs.writeFile(file, existing);
  const run = spawnSync(process.execPath, ['src/cli.mjs', 'init', file], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /SNAPSHOT_EXISTS/);
  assert.equal(await fs.readFile(file, 'utf8'), existing);
  const json = spawnSync(
    process.execPath,
    ['src/cli.mjs', 'init', file, '--json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(json.status, 1);
  assert.deepEqual(JSON.parse(json.stdout), {
    valid: false,
    errors: ['SNAPSHOT_EXISTS'],
    diagnostics: [],
  });
  assert.equal(await fs.readFile(file, 'utf8'), existing);
});

test('the help text offers init and the CLI refuses it with unrelated flags', async () => {
  const help = await fs.readFile(
    new URL('assets/archivarius-cli-help.txt', root),
    'utf8',
  );
  assert.match(help, /^\s+archivarius init <project\.json>/m);
  const bad = spawnSync(
    process.execPath,
    ['src/cli.mjs', 'init', 'unused.json', '--check'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /archivarius init/);
});
