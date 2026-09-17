import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProjectFiles } from '../src/node.mjs';

const root = new URL('../', import.meta.url);

// The reconciliation the repository can run on itself: the described relations of
// its own snapshot against the imports its own sources actually have. The report
// is the product, so a run that reads no module at all is the failure to catch.
test('the repository reconciles its own description against its own imports', async () => {
  const report = await reconcileProjectFiles(
    new URL('project.json', root).pathname,
    path.dirname(new URL('project.json', root).pathname),
  );
  assert(report.observed > 20, 'read only ' + report.observed + ' modules');
  assert(Array.isArray(report.confirmed) && report.confirmed.length > 0);
  for (const group of [
    'absent',
    'undeclared',
    'contained',
    'undeclarable',
    'unjudged',
    'unattributed',
  ])
    assert(Array.isArray(report[group]), 'no ' + group + ' group');
  // The repository holds itself to its own requirement: no declared relation the
  // code lost, and no dependency between described parts nobody declared.
  assert.deepEqual(
    report.absent.map((entry) => entry.relation),
    [],
  );
  assert.deepEqual(
    report.undeclared.map((entry) => entry.from + ' -> ' + entry.to),
    [],
  );
  // Every declared relation is answered exactly once, so the report is complete.
  const answered = new Set(
    [...report.confirmed, ...report.absent, ...report.unjudged].map(
      (entry) => entry.relation,
    ),
  );
  assert.equal(
    answered.size,
    report.confirmed.length + report.absent.length + report.unjudged.length,
  );
});

// A dependency the code has and the model does not declare is the whole point:
// the run must report it rather than pass because the digests still match.
test('an undeclared dependency between bound parts is reported by name', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-'));
  const model = JSON.parse(
    await fs.readFile(new URL('models/documentation.json', root), 'utf8'),
  );
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'src', 'a.mjs'),
    "import './b.mjs';\n",
  );
  await fs.writeFile(
    path.join(directory, 'src', 'b.mjs'),
    'export const b = 1;\n',
  );
  // Two leaves: a relation may not end on a container, so a container's edge is
  // answered as undeclarable rather than as a missing record.
  const parents = new Set(
    model.records.map((record) => record.parent).filter(Boolean),
  );
  const components = model.records.filter(
    (record) => record.type === 'component' && !parents.has(record.key),
  );
  // Two leaves with no relation between them, so the edge the code has is a
  // dependency nobody declared rather than one the model already states.
  const declared = new Set(
    model.records
      .filter((record) => record.type === 'interaction')
      .map((record) => record.from + '\u0000' + record.to),
  );
  const [from, to] = [components[0], components.at(-1)];
  assert(!declared.has(from.key + '\u0000' + to.key), 'already declared');
  model.bindings = {
    [from.key]: { path: 'src/a.mjs', digest: 'a'.repeat(64) },
    [to.key]: { path: 'src/b.mjs', digest: 'b'.repeat(64) },
  };
  const file = path.join(directory, 'model.json');
  await fs.writeFile(file, JSON.stringify(model));
  const report = await reconcileProjectFiles(file, directory);
  assert(
    report.undeclared.some(
      (edge) => edge.from === from.key && edge.to === to.key,
    ),
    JSON.stringify(report),
  );
  await fs.rm(directory, { recursive: true, force: true });
});

// A contradiction between the description and the code is a failure of the run,
// not a line in a report nobody reads: the command names it and exits badly, so a
// gate that only watches the exit code still catches it.
test('the command names the contradiction and exits unsuccessfully', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reconcile-cli-'));
  const model = JSON.parse(
    await fs.readFile(new URL('models/documentation.json', root), 'utf8'),
  );
  await fs.mkdir(path.join(directory, 'src'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'src', 'a.mjs'),
    "import './b.mjs';\n",
  );
  await fs.writeFile(
    path.join(directory, 'src', 'b.mjs'),
    'export const b = 1;\n',
  );
  const parents = new Set(
    model.records.map((record) => record.parent).filter(Boolean),
  );
  const leaves = model.records.filter(
    (record) => record.type === 'component' && !parents.has(record.key),
  );
  model.bindings = {
    [leaves[0].key]: { path: 'src/a.mjs', digest: 'a'.repeat(64) },
    [leaves.at(-1).key]: { path: 'src/b.mjs', digest: 'b'.repeat(64) },
  };
  const file = path.join(directory, 'model.json');
  await fs.writeFile(file, JSON.stringify(model));
  const run = spawnSync(
    process.execPath,
    ['src/cli.mjs', 'reconcile', file, '--json'],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(run.status, 1, run.stdout + run.stderr);
  // The report is printed first, then the refusal: the reader gets the evidence
  // and the name of what is wrong.
  const printed = run.stdout.split('\n{').length;
  assert.equal(printed, 2, 'the report and the refusal are not both printed');
  assert.match(run.stdout, /"valid": false/);
  assert.match(run.stdout, /DESCRIPTION_CONTRADICTED/);
  await fs.rm(directory, { recursive: true, force: true });
});
