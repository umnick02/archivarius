// Withdraw only what depended on it. A basis over the whole contract answers one
// question — did anything, anywhere, move — so one edit withdraws every claim in
// the snapshot. A per-definition basis names each definition a record actually
// rested on, so the same edit withdraws its dependents and leaves the rest
// standing. These cases hold that difference on the shared fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/model/digest.mjs';
import {
  contractDigest,
  definitionBasis,
  movedDefinitions,
  snapshotManifest,
} from '../src/model/project-digest.mjs';
import { reviewSelection } from '../src/model/project-selection.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import { get, ready } from './project-fixture.mjs';

// The same two steps an authored review takes: write a receipt naming every
// definition it rested on, then store the manifest that receipt points back at.
const scoped = (model = ready()) => {
  const contract = contractDigest(model);
  for (const record of model.records)
    if ('basis' in record && record.type !== 'result')
      record.basis = {
        contract,
        definitions: definitionBasis(model, record.key),
      };
  model.snapshots.push(snapshotManifest(model));
  return model;
};

// An edit keeps the revision it replaced, so the snapshot a receipt names can
// still be rebuilt — exactly what applying a change does.
const edit = (model, key, change) => {
  const record = get(model, key);
  model.history.push({
    digest: digest(record),
    record: structuredClone(record),
  });
  Object.assign(record, change);
  return model;
};

const claims = (model) => {
  const report = analyzeProject(model);
  return Object.fromEntries(
    model.records
      .filter((r) => 'basis' in r)
      .map((r) => [r.key, report.freshness[r.key].current]),
  );
};

test('a per-definition basis names each definition a record rested on, and nothing it merely sits beside', () => {
  const model = ready();
  for (const key of ['implement-export', 'export-check', 'streaming'])
    assert.deepEqual(
      Object.keys(definitionBasis(model, key)).sort(),
      reviewSelection(model, [key])
        .records.filter((r) => r.type !== 'result')
        .map((r) => r.key)
        .sort(),
      key + ' rests on a different set than it was reviewed over',
    );
  const task = definitionBasis(model, 'implement-export');
  const check = definitionBasis(model, 'export-check');
  // The task was written against the decision it uses; the check was not.
  assert.ok(task.streaming, 'the task does not rest on the decision it uses');
  assert.equal(check.streaming, undefined);
  // Neither rests on an interface it never names.
  assert.equal(task['result-contract'], undefined);
  assert.equal(check['result-contract'], undefined);
  for (const value of Object.values(task))
    assert.match(value, /^[0-9a-f]{64}$/);
});

test('a changed definition withdraws its dependents and leaves every other claim standing', () => {
  const model = edit(scoped(), 'streaming', {
    because: 'Streaming keeps the peak memory of an export flat.',
  });
  assert.deepEqual(validateProject(model).diagnostics, []);
  const standing = claims(model);
  assert.equal(standing['implement-export'], false);
  assert.equal(standing['export-check'], true);
  // The rewritten decision is its own dependent, so its own review goes too.
  assert.equal(standing.streaming, false);
  const reasons = analyzeProject(model).freshness['implement-export'].reasons;
  assert.deepEqual(reasons, [
    { code: 'BASIS_CHANGED', key: 'implement-export', moved: ['streaming'] },
  ]);
});

test('a whole-contract basis withdraws every claim in the snapshot, which is what the per-definition basis replaces', () => {
  const model = ready();
  const contract = contractDigest(model);
  for (const record of model.records)
    if ('basis' in record && record.type !== 'result')
      record.basis = { contract };
  const edited = edit(model, 'streaming', {
    because: 'Streaming keeps the peak memory of an export flat.',
  });
  assert.deepEqual(
    Object.values(claims(edited)),
    Object.values(claims(edited)).map(() => false),
    'a whole-contract basis left a claim standing',
  );
});

test('a definition re-reviewed, relabelled or reasoned about again withdraws nothing', () => {
  const model = scoped();
  const withdrawn = () =>
    Object.entries(claims(model))
      .filter(([, current]) => !current)
      .map(([key]) => key);
  assert.deepEqual(withdrawn(), []);
  edit(model, 'streaming', {
    title: 'Stream the export',
    reconsideredBecause: 'Read again against the same sources.',
    basis: {
      contract: contractDigest(model),
      definitions: definitionBasis(model, 'streaming'),
    },
  });
  assert.deepEqual(withdrawn(), []);
});

test('the definitions that moved are named, and a basis that records none withdraws nothing of its own', () => {
  const model = edit(scoped(), 'row-limit', {
    statement: 'An export answers with at most one thousand rows.',
  });
  const task = get(model, 'implement-export');
  assert.deepEqual(movedDefinitions(model, task), ['row-limit']);
  const check = get(model, 'export-check');
  assert.deepEqual(movedDefinitions(model, check), ['row-limit']);
  assert.equal(
    movedDefinitions(model, { ...task, basis: { contract: 'a' } }),
    null,
  );
  assert.equal(movedDefinitions(model, { ...task, basis: null }), null);
  assert.equal(movedDefinitions(model, { key: 'x', type: 'component' }), null);
});

test('the contract holds a per-definition basis to the snapshot it names', () => {
  // A model is its own snapshot under its own contract, so a receipt written
  // against it is read back from it.
  const model = scoped();
  model.snapshots = [];
  get(model, 'implement-export').basis.definitions.streaming = 'f'.repeat(64);
  const report = validateProject(model);
  assert.equal(report.valid, false);
  assert.deepEqual(
    report.diagnostics.map((d) => d.code + ':' + d.subject),
    ['BASIS_DEFINITIONS_MISMATCH:implement-export'],
  );
  const orphan = scoped();
  orphan.snapshots = [];
  get(orphan, 'implement-export').basis.contract = 'a'.repeat(64);
  assert.deepEqual(
    validateProject(orphan).diagnostics.map((d) => d.code + ':' + d.subject),
    ['BASIS_SNAPSHOT_MISSING:implement-export'],
  );
});
