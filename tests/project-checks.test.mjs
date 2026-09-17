import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { diffProject } from '../src/model/project-diff.mjs';
import {
  diffProjectFiles,
  executeProjectCheck,
  verifyProjectFiles,
  updateProjectFile,
} from '../src/node.mjs';
import { digest, hashBytes } from '../src/model/digest.mjs';
import {
  contractDigest,
  realizationDigest,
  snapshotManifest,
} from '../src/model/project-digest.mjs';
import { bind, get, ready, seal } from './project-fixture.mjs';

test('actual check records bind command, source bytes and outcome; stale and missing evidence cannot confirm', async (t) => {
  const directory = await fs.mkdtemp(
    new URL('../.runtime/project-test-', import.meta.url),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checker = await fs.readFile(
    new URL('fixtures/evidence-check.mjs', import.meta.url),
  );
  await fs.writeFile(path.join(directory, 'fixture.mjs'), checker);
  assert.equal(
    hashBytes(checker),
    createHash('sha256').update(checker).digest('hex'),
  );
  const model = ready();
  bind(model, hashBytes(checker));
  get(model, 'export-check').command = [process.execPath, 'fixture.mjs'];
  seal(model);
  const record = await executeProjectCheck(model, 'export-check', {
    directory,
    resultKey: 'run',
    evidencePath: 'evidence/run.json',
  });
  model.records.push(record);
  assert.equal(record.outcome, 'pass');
  assert.equal(
    (await verifyProjectFiles(model, directory)).analysis.completion.project
      .implemented,
    true,
  );
  assert.equal(analyzeProject(model).completion.project.implemented, false);
  await fs.appendFile(path.join(directory, 'fixture.mjs'), '\n');
  assert.equal(
    (await verifyProjectFiles(model, directory)).analysis.completion.project
      .implemented,
    false,
  );
  await fs.writeFile(path.join(directory, 'fixture.mjs'), checker);
  await fs.rm(path.join(directory, 'evidence/run.json'));
  assert.equal(
    (await verifyProjectFiles(model, directory)).analysis.completion.project
      .implemented,
    false,
  );
  const file = path.join(directory, 'project.json');
  await fs.writeFile(file, JSON.stringify(model));
  const context = projectContext(model, ['writer']),
    before = await fs.readFile(file, 'utf8');
  await assert.rejects(
    updateProjectFile(file, context, { remove: ['writer'] }),
  );
  assert.equal(await fs.readFile(file, 'utf8'), before);
  await fs.writeFile(file + '.lock', '');
  await assert.rejects(updateProjectFile(file, context, { put: [] }), {
    code: 'MODEL_BUSY',
  });
  await fs.rm(file + '.lock');
  const change = {
    put: [
      { ...get(model, 'writer'), title: get(model, 'writer').title + ' v2' },
    ],
  };
  const alias = path.join(directory, 'alias.json');
  await fs.symlink(file, alias);
  await updateProjectFile(alias, context, change);
  assert.equal((await fs.lstat(alias)).isSymbolicLink(), true);
  await assert.rejects(updateProjectFile(file, context, change), {
    code: 'CONTEXT_CHANGED',
  });
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      ['src/cli.mjs', 'context', file, '--focus', 'writer'],
      { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
    ),
  );
  assert(output.reads.writer);
});

// One authored edit over the shared fixture, made through the authoring API so the
// snapshot manifest and the immutable revisions are the real ones: three records
// reviewed against their dependencies, then one requirement reworded, one
// interaction dropped and one decision added in a single change.
const buffering = {
  key: 'buffering',
  type: 'decision',
  title: 'Buffered writes',
  scope: 'project',
  topic: 'write-buffer',
  choice: 'Buffer accepted rows before writing them.',
  alternatives: ['Write every accepted row on its own.'],
  because: 'Fewer writes finish the export sooner.',
  consequences: ['A buffer must be flushed when a write fails.'],
  affects: ['writer'],
  uses: ['row-limit'],
  basis: null,
};
const reviewedKeys = ['streaming', 'implement-export', 'export-check'];
const reviewed = () => {
  const model = ready();
  return applyProjectChanges(model, projectContext(model, reviewedKeys), {
    review: reviewedKeys,
    reason: 'Reviewed against the dependencies each record rests on.',
  });
};
const edited = (model) => {
  const requirement = get(model, 'explicit-result');
  const bindings = { ...model.bindings };
  delete bindings.rejected;
  return applyProjectChanges(
    model,
    projectContext(model, ['explicit-result', 'rejected']),
    {
      put: [
        {
          ...requirement,
          rule: requirement.rule + ' The reason names the rule that refused.',
        },
        buffering,
      ],
      remove: ['rejected'],
      bindings,
    },
  );
};

test('the snapshot diff names the added, removed and changed records and the fields that moved', () => {
  const before = reviewed(),
    after = edited(before);
  const diff = diffProject(after, before);
  assert.deepEqual(diff.added, [
    { key: 'buffering', type: 'decision', title: 'Buffered writes' },
  ]);
  assert.deepEqual(diff.removed, [
    {
      key: 'rejected',
      type: 'interaction',
      title: get(before, 'rejected').title,
    },
  ]);
  assert.deepEqual(diff.changed, [
    {
      key: 'explicit-result',
      type: 'requirement',
      title: get(after, 'explicit-result').title,
      fields: ['rule'],
    },
  ]);
  assert.deepEqual(diff.moved, ['buffering', 'explicit-result', 'rejected']);
  assert.equal(diff.before.snapshot, digest(snapshotManifest(before)));
  assert.equal(diff.after.snapshot, digest(snapshotManifest(after)));
  assert.equal(diff.after.contract, contractDigest(after));
  assert.equal(diff.before.contract, contractDigest(before));
  // The dropped interaction dropped its binding with it.
  assert.equal(diff.before.realization, realizationDigest(before));
  assert.notEqual(diff.before.realization, diff.after.realization);
});

// Re-reviewing a record is not a change to what it claims, so a receipt on its own
// must not appear in the diff at all.
test('the snapshot diff reads definitions, so a review receipt alone is not a change', () => {
  const model = ready(),
    after = reviewed();
  const diff = diffProject(after, model);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.moved, []);
  assert.deepEqual(diff.readingList, []);
});

test('the snapshot diff reports what lost its basis and names the definition that moved', () => {
  const before = reviewed(),
    after = edited(before);
  const diff = diffProject(after, before);
  assert.deepEqual(
    diff.readingList.map((entry) => entry.key),
    ['buffering', 'export-check', 'streaming', 'implement-export'],
  );
  assert.deepEqual(
    diff.readingList.map((entry) => [entry.key, entry.code, entry.moved]),
    [
      ['buffering', 'BASIS_MISSING', ['buffering', 'explicit-result']],
      ['export-check', 'BASIS_CHANGED', ['explicit-result']],
      ['streaming', 'BASIS_CHANGED', ['explicit-result']],
      ['implement-export', 'BASIS_CHANGED', ['explicit-result']],
    ],
  );
  // A reading list is worked through, so a stale prerequisite is read first.
  const order = diff.readingList.map((entry) => entry.key);
  assert(
    order.indexOf('streaming') < order.indexOf('implement-export'),
    'implement-export rests on streaming and must be read after it',
  );
  // Complete: exactly the records the analysis finds without a standing basis.
  const stale = Object.entries(analyzeProject(after).freshness)
    .filter(([, state]) =>
      state.reasons.some((reason) => reason.code.startsWith('BASIS_')),
    )
    .map(([key]) => key);
  assert.deepEqual(order.slice().sort(), stale.slice().sort());
  assert.deepEqual(
    diff.readingList.map((entry) => entry.title),
    order.map((key) => get(after, key).title),
  );
});

test('the freshness report reads one snapshot against its own stored manifest', () => {
  const after = edited(reviewed());
  const stored = after.snapshots.at(-1);
  const diff = diffProject(after);
  assert.equal(diff.before.snapshot, digest(stored));
  assert.deepEqual(
    diff.added.map((r) => r.key),
    ['buffering'],
  );
  assert.deepEqual(
    diff.removed.map((r) => r.key),
    ['rejected'],
  );
  assert.deepEqual(
    diff.changed.map((r) => r.key),
    ['explicit-result'],
  );
  assert.deepEqual(diff.moved, ['buffering', 'explicit-result', 'rejected']);
  assert.deepEqual(diff, diffProject(after, stored));
  assert.deepEqual(
    diff.readingList,
    diffProject(after, reviewed()).readingList,
  );
});

test('the freshness report names a definition that moved before the last stored manifest', () => {
  const after = edited(reviewed());
  // A later, unrelated edit: the most recent manifest no longer holds the change
  // that emptied the bases, so only the immutable revisions can still name it.
  const screen = get(after, 'screen');
  const later = applyProjectChanges(after, projectContext(after, ['screen']), {
    put: [{ ...screen, title: screen.title + ' (owner view)' }],
  });
  const diff = diffProject(later);
  assert.deepEqual(
    diff.changed.map((r) => r.key),
    ['screen'],
  );
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
  assert.deepEqual(
    diff.readingList.map((entry) => [entry.key, entry.moved]),
    [
      ['buffering', ['explicit-result']],
      ['export-check', ['explicit-result', 'screen']],
      ['streaming', ['explicit-result']],
      ['implement-export', ['explicit-result', 'screen']],
    ],
  );
});

test('the diff command reports the snapshot diff and, with --stale, only the reading list', async (t) => {
  const directory = await fs.mkdtemp(
    new URL('../.runtime/project-diff-', import.meta.url),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const before = reviewed(),
    after = edited(before);
  const file = path.join(directory, 'project.json'),
    past = path.join(directory, 'before.json'),
    report = path.join(directory, 'diff.json');
  await fs.writeFile(file, JSON.stringify(after));
  await fs.writeFile(past, JSON.stringify(before));
  const root = new URL('../', import.meta.url);
  const run = (args) =>
    JSON.parse(
      execFileSync(process.execPath, ['src/cli.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
      }),
    );
  const diff = run(['diff', file]);
  assert.deepEqual(diff.moved, ['buffering', 'explicit-result', 'rejected']);
  assert.deepEqual(diff, run(['diff', file, '--against', past]));
  const stale = run(['diff', file, '--stale']);
  assert.deepEqual(Object.keys(stale).sort(), [
    'after',
    'before',
    'moved',
    'readingList',
  ]);
  assert.deepEqual(stale.readingList, diff.readingList);
  assert.equal(
    execFileSync(
      process.execPath,
      ['src/cli.mjs', 'diff', file, '--output', report],
      { cwd: root, encoding: 'utf8' },
    ).trim(),
    report,
  );
  assert.deepEqual(JSON.parse(await fs.readFile(report, 'utf8')), diff);
  assert.deepEqual(await diffProjectFiles(file), diff);
  assert.deepEqual(await diffProjectFiles(file, past), diff);
});
