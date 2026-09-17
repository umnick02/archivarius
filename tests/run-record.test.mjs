// An outcome comes from a run. The receipt a run stores has to say enough for a
// later reader to tell that a run really happened and what it happened against:
// the command, its exit status, the bytes of its output and the contract and
// source bytes it ran against. A result nobody ran is refused by name.
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProjectCheck } from '../src/node.mjs';
import { runEvidence, verifyProjectEvidence } from '../src/model/evidence.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { digest, hashBytes } from '../src/model/digest.mjs';
import {
  contractDigest,
  realizationDigest,
} from '../src/model/project-digest.mjs';
import { bind, get, ready, receipt, seal } from './project-fixture.mjs';

const root = new URL('../', import.meta.url);
const encode = (value) => new TextEncoder().encode(value);

// A project whose one result is confirmable from bytes this suite holds, so a
// receipt can be rewritten field by field without touching a filesystem.
const recorded = (fields = {}) => {
  const binding = encode('export const check = true;\n');
  const model = ready();
  bind(model, hashBytes(binding));
  get(model, 'export-check').command = ['node', 'fixture.mjs'];
  seal(model);
  const record = receipt(model);
  const evidence = encode(
    JSON.stringify({
      ...runEvidence(model, get(model, 'export-check'), {
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
      }),
      ...fields,
    }),
  );
  record.evidence = [{ path: 'run.json', digest: hashBytes(evidence) }];
  model.records.push(record);
  const bytes = { 'fixture.mjs': binding, 'run.json': evidence };
  return {
    model,
    record,
    verify: () =>
      verifyProjectEvidence(model, (name) => {
        if (!bytes[name]) throw new Error('ARTIFACT_PATH');
        return bytes[name];
      }),
  };
};

test('a run receipt states the command, the exit status, the output bytes and what it ran against', () => {
  const model = ready();
  bind(model, 'c'.repeat(64));
  const check = get(model, 'export-check');
  check.command = ['node', 'fixture.mjs'];
  seal(model);
  const evidence = runEvidence(model, check, {
    exitCode: 3,
    stdout: 'first\n',
    stderr: 'second\n',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:02.000Z',
  });
  assert.equal(evidence.version, 1);
  assert.equal(evidence.check, check.key);
  assert.equal(evidence.outcome, 'fail');
  assert.deepEqual(evidence.command, check.command);
  assert.equal(evidence.exitCode, 3);
  // The output is carried by a digest over the bytes, so a receipt cannot be
  // quietly reworded after the fact.
  assert.equal(evidence.output.digest, hashBytes(encode('first\nsecond\n')));
  assert.equal(evidence.output.bytes, encode('first\nsecond\n').length);
  // What it ran against: the contract it read and the source bytes it hashed.
  assert.equal(evidence.contract, contractDigest(model));
  assert.equal(evidence.realization, realizationDigest(model));
  assert.deepEqual(evidence.bindings, model.bindings);
  assert.equal(digest(evidence.bindings), evidence.realization);
  assert.equal(
    runEvidence(model, check, { exitCode: 0, stdout: '', stderr: '' }).outcome,
    'pass',
  );
});

test('a receipt that describes its run confirms the result', async () => {
  const { record, verify } = recorded();
  const evidence = await verify();
  assert.deepEqual(evidence.verifiedResults, [record.key]);
  assert.deepEqual(evidence.diagnostics, []);
});

test('a receipt whose recorded output does not hash to its digest confirms nothing', async () => {
  const { record, verify } = recorded({ stdout: 'quietly reworded\n' });
  const evidence = await verify();
  assert.deepEqual(evidence.verifiedResults, []);
  assert.deepEqual(evidence.diagnostics, [
    { code: 'EVIDENCE_INVALID', key: record.key },
  ]);
});

test('a receipt whose stated source bytes are not the ones it ran against confirms nothing', async () => {
  const { record, verify } = recorded({
    bindings: {
      'fixture.mjs': { path: 'fixture.mjs', digest: 'd'.repeat(64) },
    },
  });
  const evidence = await verify();
  assert.deepEqual(evidence.diagnostics, [
    { code: 'EVIDENCE_INVALID', key: record.key },
  ]);
});

// A receipt written before the run said this much still describes a run, so the
// fields it does not carry are not read as a contradiction.
test('a receipt that states no output digest is still read for what it does state', async () => {
  const { record, verify } = recorded({
    output: undefined,
    bindings: undefined,
    stdout: undefined,
    stderr: undefined,
  });
  const evidence = await verify();
  assert.deepEqual(evidence.verifiedResults, [record.key]);
});

test('an executed check writes a receipt that describes its own run', async (t) => {
  const directory = await fs.mkdtemp(new URL('.runtime/run-record-', root));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const checker = await fs.readFile(
    new URL('fixtures/evidence-check.mjs', import.meta.url),
  );
  await fs.writeFile(path.join(directory, 'fixture.mjs'), checker);
  const model = ready();
  bind(model, hashBytes(checker));
  get(model, 'export-check').command = [process.execPath, 'fixture.mjs'];
  seal(model);
  const record = await executeProjectCheck(model, 'export-check', {
    directory,
    resultKey: 'run',
    evidencePath: 'run.json',
  });
  model.records.push(record);
  const bytes = await fs.readFile(path.join(directory, 'run.json'));
  assert.equal(hashBytes(new Uint8Array(bytes)), record.evidence[0].digest);
  const stored = JSON.parse(bytes.toString('utf8'));
  assert.deepEqual(stored.command, [process.execPath, 'fixture.mjs']);
  assert.equal(stored.exitCode, 0);
  assert.equal(stored.contract, contractDigest(model));
  assert.deepEqual(stored.bindings, model.bindings);
  assert.equal(
    stored.output.digest,
    hashBytes(encode(stored.stdout + stored.stderr)),
  );
  const verified = await verifyProjectEvidence(
    model,
    async (name) =>
      new Uint8Array(await fs.readFile(path.join(directory, name))),
  );
  assert.deepEqual(verified.verifiedResults, ['run']);
});

test('a result whose outcome no run stands behind is refused by name', () => {
  const model = ready();
  const base = {
    key: 'claimed',
    type: 'result',
    title: 'Claimed run',
    scope: model.root,
    check: 'export-check',
    outcome: 'pass',
    basis: { contract: contractDigest(model) },
    realization: realizationDigest(model),
    evidence: [{ path: 'run.json', digest: 'a'.repeat(64) }],
    resolves: [],
  };
  const put = (record) =>
    applyProjectChanges(model, projectContext(model, ['export-check']), {
      put: [record],
    });
  // A run against this model's own contract and bound bytes is recordable.
  assert.equal(
    put(base).records.some((r) => r.key === 'claimed'),
    true,
  );
  // A basis that names no contract this model has is an outcome nobody ran.
  assert.throws(() => put({ ...base, basis: { contract: 'f'.repeat(64) } }), {
    code: 'OUTCOME_NOT_RUN',
    issues: ['claimed'],
  });
  assert.throws(() => put({ ...base, realization: 'f'.repeat(64) }), {
    code: 'OUTCOME_NOT_RUN',
  });
  // No basis at all is already refused by the contract, not by this rule.
  assert.throws(() => put({ ...base, basis: null }), {
    code: 'INVALID_MODEL',
    issues: ['RESULT_BASIS:claimed'],
  });
});
