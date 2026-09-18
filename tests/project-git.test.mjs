import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  projectContext,
  applyProjectChanges,
} from '../src/model/project-authoring.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import {
  readArchitectureFile,
  archiveProjectFile,
  updateProjectFile,
  useGitProjectHistory,
} from '../src/node.mjs';
import { example, get, receipt } from './project-fixture.mjs';

const git = (directory, ...args) =>
  execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();
const commit = (directory, message) => {
  git(directory, 'add', '.');
  git(directory, 'commit', '--quiet', '-m', message);
  return git(directory, 'rev-parse', 'HEAD');
};
const raw = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

async function repository(t) {
  await fs.mkdir(new URL('../.runtime/', import.meta.url), { recursive: true });
  const directory = await fs.mkdtemp(
    new URL('../.runtime/git-history-', import.meta.url),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  git(directory, 'init', '--quiet');
  git(directory, 'config', 'user.email', 'test@example.invalid');
  git(directory, 'config', 'user.name', 'Fixture');
  const file = path.join(directory, 'docs', 'project model.json');
  await fs.mkdir(path.dirname(file));
  const model = structuredClone(example);
  model.records.push({ ...get(model, 'owner-intent'), key: 'unrelated' });
  const reviewed = applyProjectChanges(
    model,
    projectContext(model, [model.root]),
    {
      review: model.records
        .filter((r) => 'basis' in r && r.type !== 'result')
        .map((r) => r.key),
      reason: 'Review the fixture before changing history storage.',
    },
  );
  await fs.writeFile(file, JSON.stringify(reviewed));
  return { directory, file };
}

test('Git migration preserves history and currency after sidecars are removed, without touching the index', async (t) => {
  const { directory, file } = await repository(t);
  const initial = await readArchitectureFile(file);
  initial.records.push({ ...receipt(initial), outcome: 'fail' });
  await fs.writeFile(file, JSON.stringify(initial));
  await updateProjectFile(file, projectContext(initial, ['run']), {
    remove: ['run'],
  });
  await archiveProjectFile(file);
  const head = commit(directory, 'Retain complete original history');
  const before = await readArchitectureFile(file);
  assert(
    analyzeProject(before).completion['export-check'].reasons.some(
      (reason) => reason.code === 'CHECK_FAILED',
    ),
  );
  await fs.writeFile(path.join(directory, 'unrelated.txt'), 'staged work');
  git(directory, 'add', 'unrelated.txt');
  const index = git(directory, 'diff', '--cached', '--binary');
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      ['src/cli.mjs', 'git-history', file, '--json'],
      { encoding: 'utf8' },
    ),
  );
  assert.deepEqual(output, { valid: true, history: 'git' });
  const encoded = await raw(file);
  assert.deepEqual(encoded.archive, {
    version: 2,
    commit: head,
    path: 'docs/project model.json',
  });
  assert.deepEqual(encoded.history, []);
  assert.deepEqual(encoded.snapshots, []);
  assert.equal(git(directory, 'rev-parse', 'HEAD'), head);
  assert.equal(git(directory, 'diff', '--cached', '--binary'), index);
  await fs.rm(file + '.history', { recursive: true });
  const loaded = await readArchitectureFile(file);
  assert.deepEqual(loaded.records, before.records);
  assert.deepEqual(analyzeProject(loaded), analyzeProject(before));
  for (const revision of before.history)
    assert(loaded.history.some((item) => item.digest === revision.digest));
  // A fresh clone needs only normal Git history, not files left in this worktree.
  commit(directory, 'Use Git history and remove sidecars');
  const clone = path.join(directory, 'clone');
  execFileSync('git', ['clone', '--quiet', '--no-local', directory, clone]);
  assert.deepEqual(
    (await readArchitectureFile(path.join(clone, 'docs/project model.json')))
      .records,
    before.records,
  );
});

test('uncommitted edits retain exact receipts and the next committed base absorbs their pending history', async (t) => {
  const { directory, file } = await repository(t);
  commit(directory, 'Initial model');
  await useGitProjectHistory(file);
  commit(directory, 'Use Git history');
  const base = await readArchitectureFile(file);
  const unrelatedContext = projectContext(base, ['unrelated']);
  const oldContext = projectContext(base, ['row-limit']);
  let next = await updateProjectFile(file, oldContext, {
    put: [{ ...get(base, 'row-limit'), rule: 'First changed limit.' }],
  });
  assert.equal(analyzeProject(next).freshness['export-check'].current, false);
  next = await updateProjectFile(file, projectContext(next, ['row-limit']), {
    put: [{ ...get(next, 'row-limit'), rule: 'Second changed limit.' }],
  });
  assert(
    (await raw(file)).history.length > 0,
    'Intermediate uncommitted versions are retained',
  );
  assert.deepEqual(await readArchitectureFile(file), next);
  const stable = await fs.readFile(file, 'utf8');
  await assert.rejects(updateProjectFile(file, oldContext, { put: [] }), {
    code: 'CONTEXT_CHANGED',
  });
  assert.equal(await fs.readFile(file, 'utf8'), stable);
  const head = commit(directory, 'Commit both authoring steps');
  next = await updateProjectFile(file, unrelatedContext, {
    put: [
      {
        ...get(base, 'unrelated'),
        statement: 'Independent change from the earlier receipt.',
      },
    ],
  });
  assert.equal((await raw(file)).archive.commit, head);
  assert.deepEqual((await raw(file)).history, []);
  assert.deepEqual((await raw(file)).snapshots, []);
  assert.equal(get(next, 'row-limit').rule, 'Second changed limit.');
  assert.equal(
    get(next, 'unrelated').statement,
    'Independent change from the earlier receipt.',
  );
  await assert.rejects(fs.stat(file + '.history'), { code: 'ENOENT' });
  assert.deepEqual(await readArchitectureFile(file), next);
});

test('migration refuses uncommitted history and unavailable Git objects without changing the model', async (t) => {
  const { directory, file } = await repository(t);
  const initial = await fs.readFile(file, 'utf8');
  await assert.rejects(useGitProjectHistory(file), {
    code: 'GIT_HISTORY_UNAVAILABLE',
  });
  assert.equal(await fs.readFile(file, 'utf8'), initial);
  commit(directory, 'Initial model');
  const model = await readArchitectureFile(file);
  await updateProjectFile(file, projectContext(model, ['row-limit']), {
    put: [{ ...get(model, 'row-limit'), rule: 'Uncommitted change.' }],
  });
  const changed = await fs.readFile(file, 'utf8');
  await assert.rejects(useGitProjectHistory(file), {
    code: 'GIT_HISTORY_UNCOMMITTED',
  });
  assert.equal(await fs.readFile(file, 'utf8'), changed);
  commit(directory, 'Retain changed model');
  await useGitProjectHistory(file);
  const encoded = await raw(file);
  await fs.writeFile(
    file,
    JSON.stringify({
      ...encoded,
      archive: { ...encoded.archive, commit: 'f'.repeat(40) },
    }),
  );
  await assert.rejects(readArchitectureFile(file), {
    code: 'GIT_HISTORY_UNAVAILABLE',
  });
  for (const name of [
    '../outside.json',
    '/outside.json',
    'docs/../project.json',
    'docs\\project.json',
    '.',
  ]) {
    await fs.writeFile(
      file,
      JSON.stringify({
        ...encoded,
        archive: { ...encoded.archive, path: name },
      }),
    );
    await assert.rejects(readArchitectureFile(file), {
      code: 'GIT_HISTORY_REFERENCE',
    });
  }
});
