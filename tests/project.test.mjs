import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateArchitecture, parseArchitecture } from '../src/core.mjs';
import {
  validateProject,
  analyzeProject,
  projectContext,
  applyProjectChanges,
  contractDigest,
  realizationDigest,
  digest,
} from '../src/project.mjs';
import {
  executeProjectCheck,
  verifyProjectFiles,
  updateProjectFile,
  generateDocumentation,
} from '../src/node.mjs';
import { hashBytes } from '../src/digest.mjs';
import { readArchitecture, prepareArchitecture } from '../src/load.mjs';

const example = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/project.json', import.meta.url),
    'utf8',
  ),
);
const clone = () => structuredClone(example);
const get = (model, key) => model.records.find((r) => r.key === key);
const seal = (model) => {
  const contract = contractDigest(model);
  for (const r of model.records)
    if ('basis' in r && r.type !== 'result') r.basis = { contract };
  return model;
};
const ready = () => {
  const model = clone();
  model.records = model.records.filter((r) => r.key !== 'exclude-private');
  model.bindings = { fixture: { path: 'fixture.mjs', digest: 'a'.repeat(64) } };
  return seal(model);
};
const receipt = (model) => ({
  key: 'run',
  type: 'result',
  title: get(model, 'export-check').title,
  scope: model.root,
  check: 'export-check',
  outcome: 'pass',
  basis: { contract: contractDigest(model) },
  realization: realizationDigest(model),
  evidence: [{ path: 'run.json', digest: 'b'.repeat(64) }],
  resolves: [],
});

test('requirements can be explored before architecture exists without inventing participants', async () => {
  const model = clone();
  model.entry = null;
  model.records = model.records.filter((r) =>
    ['scope', 'source', 'requirement'].includes(r.type),
  );
  for (const requirement of model.records.filter(
    (r) => r.type === 'requirement',
  ))
    requirement.appliesTo = [model.root];
  assert.equal(validateProject(model).valid, true);
  const prepared = await prepareArchitecture(model);
  assert.equal(prepared.graph.nodes.size, 0);
  assert.equal(prepared.layout.layoutPasses, 0);
  assert.equal(prepared.analysis.completion[model.root].implemented, false);
});

test('compact project is valid, typed, navigable and deliberately incomplete', async () => {
  assert.equal(validateProject(example).valid, true);
  assert.deepEqual(parseArchitecture(JSON.stringify(example)), example);
  assert.deepEqual(await readArchitecture(example), example);
  const prepared = await prepareArchitecture(example);
  assert.equal(prepared.graph.nodes.size, 4);
  assert.equal(prepared.analysis.completion.project.implemented, false);
  assert(
    prepared.analysis.completion.project.reasons.some(
      (r) => r.key === 'exclude-private',
    ),
  );
  for (const edit of [
    (m) => {
      get(m, 'writer').implemented = true;
    },
    (m) => {
      get(m, 'row-limit').sources = ['writer'];
    },
    (m) => {
      get(m, 'implement-export').covers = ['absent'];
    },
    (m) => {
      get(m, 'writer').parent = 'writer';
    },
    (m) => {
      get(m, 'export').parent = 'writer';
    },
    (m) => {
      get(m, 'implement-export').needs = ['implement-export'];
    },
    (m) => {
      get(m, 'row-limit').sources = ['streaming'];
    },
    (m) => {
      get(m, 'request').to = 'export';
    },
    (m) => {
      get(m, 'writer').boundary = undefined;
    },
    (m) => {
      m.records.push(structuredClone(get(m, 'writer')));
    },
    (m) => {
      m.records.push({ ...get(m, 'streaming'), key: 'conflict' });
    },
    (m) => {
      m.records = m.records.filter((r) => r.type !== 'interaction');
    },
  ]) {
    const m = clone();
    edit(m);
    assert.equal(validateProject(m).valid, false, edit.toString());
  }
});

test('confirmation needs current external evidence, complete coverage and integration', () => {
  const model = ready();
  model.records.push(receipt(model));
  assert.equal(analyzeProject(model).completion.project.implemented, false);
  assert.equal(
    analyzeProject(model, { verifiedResults: ['run'] }).completion.project
      .implemented,
    true,
  );
  for (const edit of [
    (m) => {
      get(m, 'row-limit').parameters.maxRows = 100;
    },
    (m) => {
      get(m, 'writer').summary = get(m, 'screen').summary;
    },
    (m) => {
      get(m, 'write-contract').payload = get(m, 'result-contract').payload;
    },
    (m) => {
      get(m, 'export-check').method = get(m, 'export-flow').steps.join(' ');
    },
    (m) => {
      m.bindings.fixture.digest = 'c'.repeat(64);
    },
    (m) => {
      m.records.push(structuredClone(get(example, 'exclude-private')));
    },
    (m) => {
      get(m, 'export-check').targets = ['writer'];
    },
    (m) => {
      get(m, 'export-check').covers = ['within-limit'];
    },
    (m) => {
      m.records.push({
        ...get(m, 'owner-intent'),
        key: 'unknown',
        origin: 'question',
      });
    },
  ]) {
    const changed = structuredClone(model);
    edit(changed);
    assert.equal(validateProject(changed).valid, true);
    assert.equal(
      analyzeProject(changed, { verifiedResults: ['run'] }).completion.project
        .implemented,
      false,
      edit.toString(),
    );
  }
  const negative = { ...receipt(model), key: 'negative', outcome: 'fail' };
  model.records.push(negative);
  assert(
    analyzeProject(model, {
      verifiedResults: ['run'],
    }).completion.project.reasons.some((r) => r.code === 'CHECK_FAILED'),
  );
  model.records = model.records.filter((r) => r.key !== 'negative');
  model.history.push({ digest: digest(negative), record: negative });
  const resurrected = structuredClone(model);
  resurrected.records.push({ ...negative, outcome: 'pass' });
  assert.equal(validateProject(resurrected).valid, false);
  assert(
    analyzeProject(model, {
      verifiedResults: ['run'],
    }).completion.project.reasons.some((r) => r.code === 'CHECK_FAILED'),
  );
});

test('LLM context carries exact definitions, inherited constraints and an unforgeable-by-trimming read set', () => {
  const model = clone();
  model.records.push({ ...get(model, 'owner-intent'), key: 'unrelated' });
  const context = projectContext(model, ['implement-export']);
  assert(context.records.some((r) => r.key === 'row-limit'));
  assert(context.records.some((r) => r.key === 'explicit-result'));
  assert(context.omitted > 0);
  const task = structuredClone(get(model, 'implement-export'));
  task.change += ' ';
  const next = applyProjectChanges(model, context, { put: [task] });
  assert.equal(next.history.length, 1);
  assert.deepEqual(get(model, task.key), get(example, task.key));
  assert.throws(() => applyProjectChanges(next, context, { put: [task] }), {
    code: 'CONTEXT_CHANGED',
  });
  const trimmed = structuredClone(context);
  delete trimmed.reads['row-limit'];
  assert.throws(() => applyProjectChanges(model, trimmed, { put: [task] }), {
    code: 'CONTEXT_CHANGED',
  });
  assert.throws(() => applyProjectChanges(model, context, { statuses: [] }), {
    code: 'INVALID_CHANGE',
  });
  task.basis = { contract: contractDigest(model) };
  assert.throws(() => applyProjectChanges(model, context, { put: [task] }), {
    code: 'REVIEW_REQUIRED',
  });
  assert.throws(
    () => applyProjectChanges(model, context, { review: [task.key] }),
    { code: 'REVIEW_REQUIRED' },
  );
  const reviewed = applyProjectChanges(model, context, {
    review: ['streaming', 'implement-export', 'export-check'],
    reason: get(model, 'streaming').because,
  });
  assert.equal(
    analyzeProject(reviewed).freshness['implement-export'].current,
    true,
  );
  assert(reviewed.history.length >= 3);
  const full = projectContext(reviewed, [reviewed.root]);
  assert.equal(full.omitted, 0);
  const renamed = applyProjectChanges(reviewed, full, {
    title: reviewed.title + ' v2',
  });
  assert.equal(validateProject(renamed).valid, true);
  assert(
    renamed.snapshots.some((snapshot) => snapshot.title === reviewed.title),
  );
});

test('documentation and history retain records and links without a separate prose source', async () => {
  const original = clone(),
    context = projectContext(original, ['row-limit']);
  const updated = structuredClone(get(original, 'row-limit'));
  updated.parameters.maxRows = 100;
  const model = applyProjectChanges(original, context, { put: [updated] });
  const markdown = await generateDocumentation(model);
  for (const record of model.records)
    assert(markdown.includes('id="record-' + record.key + '"'));
  assert(markdown.includes(digest(model)));
  assert.equal(markdown, await generateDocumentation(structuredClone(model)));
  const broken = structuredClone(model);
  broken.history[0].record.parameters.maxRows = 999;
  assert.equal(validateProject(broken).valid, false);
});

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
