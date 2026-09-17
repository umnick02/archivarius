// A confirmation stands on what it rests on, not on every byte around it. When a
// binding names a range, verification reads that range: an edit elsewhere in the
// same file leaves the receipt confirming its result, and an edit inside the
// claimed lines withdraws it by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvidence, verifyProjectEvidence } from '../src/model/evidence.mjs';
import { hashBytes } from '../src/model/digest.mjs';
import { get, ready, receipt, seal } from './project-fixture.mjs';

const encode = (text) => new TextEncoder().encode(text);
const source = 'export const check = true;\nconst kept = 1;\nconst tail = 2;\n';
const claimed = (text, from, to) =>
  hashBytes(
    encode(
      text
        .split('\n')
        .slice(from - 1, to)
        .join('\n'),
    ),
  );

// The fixture project, bound to the first two lines of one file instead of the
// whole of it, with one result a receipt in this suite's own bytes confirms. One
// part claims two ranges of the same file, which is read once.
const confirmed = () => {
  const model = ready();
  for (const key of Object.keys(model.bindings))
    model.bindings[key] = {
      parts: [
        { path: 'fixture.mjs', digest: claimed(source, 1, 2), from: 1, to: 2 },
      ],
    };
  model.bindings[Object.keys(model.bindings)[0]] = {
    parts: [
      { path: 'fixture.mjs', digest: claimed(source, 1, 1), from: 1, to: 1 },
      { path: 'fixture.mjs', digest: claimed(source, 2, 2), from: 2, to: 2 },
    ],
  };
  get(model, 'export-check').command = ['node', 'fixture.mjs'];
  seal(model);
  const record = receipt(model);
  const evidence = encode(
    JSON.stringify(
      runEvidence(model, get(model, 'export-check'), {
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
      }),
    ),
  );
  record.evidence = [{ path: 'run.json', digest: hashBytes(evidence) }];
  model.records.push(record);
  return {
    model,
    record,
    verify: (text) =>
      verifyProjectEvidence(model, (name) => {
        const bytes = { 'fixture.mjs': encode(text), 'run.json': evidence }[
          name
        ];
        if (!bytes) throw new Error('ARTIFACT_PATH');
        return bytes;
      }),
  };
};

test('an edit outside every bound range leaves the confirmation standing', async () => {
  const { record, verify } = confirmed();
  assert.deepEqual((await verify(source)).verifiedResults, [record.key]);
  // The third line is rewritten and a fourth appended: no bound range moved.
  const edited =
    'export const check = true;\nconst kept = 1;\nconst tail = 99;\nconst added = 3;\n';
  const stood = await verify(edited);
  assert.deepEqual(stood.verifiedResults, [record.key]);
  assert.deepEqual(stood.diagnostics, []);
});

test('an edit inside a bound range withdraws the confirmation by name', async () => {
  const { record, verify } = confirmed();
  const moved = await verify(
    'export const check = true;\nconst kept = 2;\nconst tail = 2;\n',
  );
  assert.deepEqual(moved.verifiedResults, []);
  assert.deepEqual(moved.diagnostics, [
    { code: 'REALIZATION_UNAVAILABLE', key: record.key },
  ]);
});

// A lost range and an unreadable file are different repairs - rebind the claim,
// or restore the file - so the diagnostic names which one happened.
test('a binding that claims a range the file no longer has confirms nothing', async () => {
  const { record, verify } = confirmed();
  const short = await verify('');
  assert.deepEqual(short.verifiedResults, []);
  assert.deepEqual(short.diagnostics, [
    { code: 'BINDING_RANGE_MISSING', key: record.key },
  ]);
});

test('a bound part whose path leaves the project confirms nothing', async () => {
  const { model, record } = confirmed();
  model.bindings[Object.keys(model.bindings)[0]] = {
    parts: [{ path: '../outside.mjs', digest: claimed(source, 1, 2) }],
  };
  const verified = await verifyProjectEvidence(model, () => encode(source));
  assert.deepEqual(verified.verifiedResults, []);
  assert.deepEqual(verified.diagnostics, [
    { code: 'REALIZATION_UNAVAILABLE', key: record.key },
  ]);
});

test('a bound range that moves while the receipts are read withdraws the confirmation', async () => {
  const { model, record } = confirmed();
  const bytes = { 'fixture.mjs': encode(source) };
  const evidence = encode(
    JSON.stringify(
      runEvidence(model, get(model, 'export-check'), {
        exitCode: 0,
        stdout: 'ok\n',
        stderr: '',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.000Z',
      }),
    ),
  );
  record.evidence = [{ path: 'run.json', digest: hashBytes(evidence) }];
  const verified = await verifyProjectEvidence(model, (name) => {
    if (name === 'run.json') {
      // The claimed lines move after the first pass read them.
      bytes['fixture.mjs'] = encode('export const check = false;\n');
      return evidence;
    }
    return bytes[name];
  });
  assert.deepEqual(verified.verifiedResults, []);
  assert.deepEqual(verified.diagnostics, [
    { code: 'REALIZATION_CHANGED', key: record.key },
  ]);
});
