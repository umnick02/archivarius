import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import { projectContext } from '../src/model/project-authoring.mjs';
import {
  executeProjectCheck,
  verifyProjectFiles,
  updateProjectFile,
} from '../src/node.mjs';
import { hashBytes } from '../src/model/digest.mjs';
import { get, ready, seal } from './project-fixture.mjs';

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
  model.bindings.fixture.digest = hashBytes(checker);
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
