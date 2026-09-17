import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest } from '../src/model/digest.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import {
  applyProjectChanges,
  projectContext,
  projectRead,
} from '../src/model/project-authoring.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import {
  contractDigest,
  dependencyDigest,
  realizationDigest,
} from '../src/model/project-digest.mjs';
import {
  readArchitectureFile,
  archiveProjectFile,
  updateProjectFile,
  writeAtomic,
} from '../src/node.mjs';
import { storeProjectStorage } from '../src/io/project-storage.mjs';
import { example, get } from './project-fixture.mjs';
const apply = (m, change) =>
  applyProjectChanges(m, projectContext(m, [m.root]), change);
const review = (m) =>
  apply(m, {
    review: m.records
      .filter((r) => 'basis' in r && r.type !== 'result')
      .map((r) => r.key),
    reason: 'Review the example dependencies.',
  });
const edit = (m, key, field) =>
  apply(m, {
    put: [{ ...get(m, key), [field]: get(m, key)[field] + ' changed' }],
  });
// A rejection is only useful if it says where it looked, so each family is read
// back the way an author reads it: the record, the field, the value and the shape.
const rejects = (change) => {
  const m = structuredClone(example);
  try {
    applyProjectChanges(m, projectContext(m, [m.root]), change);
  } catch (error) {
    return error;
  }
  return assert.fail('the change was accepted');
};
const only = (error, pick) => {
  const found = error.diagnostics.filter(pick);
  assert.equal(found.length, 1, JSON.stringify(found));
  return found[0];
};

test('a rejected change names the record, the field, the value read and the accepted shape', () => {
  const check = get(example, 'export-check');
  const { method, ...withoutMethod } = check;
  assert.equal(typeof method, 'string');
  const missing = rejects({ put: [withoutMethod] });
  assert.equal(missing.code, 'INVALID_CHANGE');
  const absent = only(
    missing,
    (d) => d.keyword === 'required' && d.field === 'method',
  );
  assert.equal(absent.record, 'export-check');
  assert.equal(absent.value, 'absent');
  for (const part of ['"check"', '"method"', 'string'])
    assert(absent.expected.includes(part), absent.expected);
  // The union reports every branch, so a branch that is not this record's says so.
  const foreign = only(
    missing,
    (d) => d.keyword === 'required' && d.field === 'origin',
  );
  assert.equal(foreign.record, 'export-check');
  assert(foreign.expected.includes('"source"'), foreign.expected);
  assert(foreign.expected.includes('"check"'), foreign.expected);

  const unknown = only(
    rejects({ put: [{ ...check, stability: 'surprise' }] }),
    (d) => d.keyword === 'unevaluatedProperties',
  );
  assert.equal(unknown.record, 'export-check');
  assert.equal(unknown.field, 'stability');
  assert.equal(unknown.value, 'the string "surprise"');
  for (const part of ['"check"', 'method'])
    assert(unknown.expected.includes(part), unknown.expected);

  const typed = only(
    rejects({ put: [{ ...check, title: 42 }] }),
    (d) => d.keyword === 'type',
  );
  assert.equal(typed.record, 'export-check');
  assert.equal(typed.field, 'title');
  assert.equal(typed.value, 'the number 42');
  for (const part of ['string', 'number'])
    assert(typed.expected.includes(part), typed.expected);

  const writer = get(example, 'writer');
  const enums = rejects({
    put: [{ ...writer, kind: 'gizmo' }],
  }).diagnostics.filter((d) => d.keyword === 'enum');
  assert(enums.length > 1, 'the union reported no competing enum');
  for (const one of enums) {
    assert.equal(one.record, 'writer');
    assert.equal(one.field, 'kind');
    assert.equal(one.value, 'the string "gizmo"');
  }
  const own = enums.find((d) => d.expected.includes('subsystem'));
  for (const part of ['"component"', 'store', 'external'])
    assert(own.expected.includes(part), own.expected);
  const other = enums.find((d) => d !== own);
  assert(other.expected.includes('"interaction"'), other.expected);
});

test('a diagnostic summarises the value it read instead of carrying it', () => {
  const writer = get(example, 'writer');
  const read = (value) => {
    const found = rejects({
      put: [{ ...writer, kind: value }],
    }).diagnostics.filter((d) => d.field === 'kind' && d.keyword === 'enum');
    assert(found.length, 'the value was accepted');
    return found[0];
  };
  const hostile = 'a\u0000<script>\n'.repeat(500);
  const long = read(hostile);
  assert(long.value.length < 200, long.value);
  assert(
    [...long.value].every((char) => char.charCodeAt(0) > 31),
    JSON.stringify(long.value),
  );
  assert(long.value.includes(String(hostile.length)), long.value);

  const nested = read(structuredClone(example));
  assert(nested.value.length < 200, nested.value);
  assert(!nested.value.includes(example.title), nested.value);
  assert(nested.value.includes('records'), nested.value);
});

test('a broken reference and a stale receipt name the record, the field, the value read and what was accepted', () => {
  const unresolved = structuredClone(example);
  get(unresolved, 'export-check').covers = ['nope'];
  const broken = validateProject(unresolved).diagnostics.find(
    (d) => d.code === 'MISSING_REFERENCE',
  );
  assert.equal(broken.record, 'export-check');
  assert.equal(broken.field, 'covers');
  assert.equal(broken.value, 'the string "nope"');
  assert(broken.expected.includes('criterion'), broken.expected);

  const mistyped = structuredClone(example);
  get(mistyped, 'export-check').covers = ['writer'];
  const wrong = validateProject(mistyped).diagnostics.find(
    (d) => d.code === 'REFERENCE_TYPE',
  );
  assert.equal(wrong.record, 'export-check');
  assert.equal(wrong.field, 'covers');
  assert.equal(wrong.value, 'the string "writer"');
  assert(wrong.expected.includes('criterion'), wrong.expected);

  const base = structuredClone(example);
  const context = projectContext(base, [base.root]);
  const changed = edit(base, 'row-limit', 'rule');
  let error;
  try {
    applyProjectChanges(changed, context, { put: [] });
  } catch (raised) {
    error = raised;
  }
  assert.equal(error?.code, 'CONTEXT_CHANGED');
  const stale = error.diagnostics.find((d) => d.record === 'row-limit');
  assert.equal(stale.field, 'reads');
  assert.equal(stale.value, 'the string "' + context.reads['row-limit'] + '"');
  assert(
    stale.expected.includes(digest(get(changed, 'row-limit'))),
    stale.expected,
  );
});

test('scoped reviews retain guards and owning prose without unrelated or cosmetic invalidation', () => {
  const base = structuredClone(example);
  base.records.push({
    ...get(base, 'row-limit'),
    key: 'unrelated',
    appliesTo: ['screen'],
  });
  base.records.push({
    key: 'governance',
    type: 'document',
    scope: base.root,
    title: 'Governance',
    path: 'governance.md',
    stage: 'implementation',
    format: 'markdown',
    blocks: [
      { kind: 'paragraph', lines: [['Required operational boundary.']] },
    ],
  });
  get(base, 'implement-export').governedBy = ['governance'];
  let m = review(base);
  const current = (model) =>
    analyzeProject(model).freshness['implement-export'].current;
  assert(current(m));
  assert(current(edit(m, 'row-limit', 'title')));
  assert(current(edit(m, 'unrelated', 'rule')));
  assert(!current(edit(m, 'row-limit', 'rule')));
  assert(!current(edit(m, 'owner-intent', 'statement')));
  assert(!current(edit(m, 'writer', 'boundary')));
  const newGuard = apply(m, {
    put: [{ ...get(m, 'unrelated'), key: 'new-guard', appliesTo: [m.root] }],
  });
  assert(!current(newGuard));
  const doc = structuredClone(get(m, 'governance'));
  doc.blocks[0].lines[0][0] += ' More policy.';
  assert(!current(apply(m, { put: [doc] })));
  const guard = { ...get(m, 'row-limit'), guards: ['unrelated'] };
  m = review(apply(m, { put: [guard] }));
  assert(!current(edit(m, 'unrelated', 'rule')));
  const short = projectRead(m, ['implement-export']);
  assert(short.records.some((r) => r.key === 'exclude-private'));
  assert(
    short.records.every(
      (r) => !('basis' in r) && !('reconsideredBecause' in r),
    ),
  );
  assert(!('reads' in short));
  assert.equal(
    short.records.some((r) => r.type === 'check'),
    false,
  );
});

test('disjoint receipts rebase but changed, trimmed and newly expanded reads reject', () => {
  const base = structuredClone(example);
  base.records.push({ ...get(base, 'owner-intent'), key: 'unrelated' });
  const context = projectContext(base, ['unrelated']);
  const changed = edit(base, 'row-limit', 'rule');
  const update = {
    put: [
      { ...get(base, 'unrelated'), statement: 'Independent updated source.' },
    ],
  };
  const next = applyProjectChanges(changed, context, update);
  assert.equal(get(next, 'row-limit').rule, get(changed, 'row-limit').rule);
  assert.equal(get(next, 'unrelated').statement, update.put[0].statement);
  assert.throws(() => applyProjectChanges(next, context, update), {
    code: 'CONTEXT_CHANGED',
  });
  const trimmed = structuredClone(context);
  trimmed.records.pop();
  assert.throws(() => applyProjectChanges(changed, trimmed, update), {
    code: 'CONTEXT_CHANGED',
  });
  const taskContext = projectContext(base, ['implement-export']);
  const expanded = apply(base, {
    put: [{ ...get(base, 'export-check'), key: 'additional-check' }],
  });
  assert.throws(() => applyProjectChanges(expanded, taskContext, { put: [] }), {
    code: 'CONTEXT_CHANGED',
  });
});

test('archive migration preserves exact models, appends immutable segments and fails closed', async (t) => {
  const directory = await fs.mkdtemp(
    new URL('../.runtime/archive-test-', import.meta.url),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'project.json'),
    m = review(structuredClone(example));
  await fs.writeFile(file, JSON.stringify(m));
  await archiveProjectFile(file);
  const encoded = JSON.parse(await fs.readFile(file));
  assert.deepEqual(encoded.history, []);
  assert.deepEqual(encoded.snapshots, []);
  assert.deepEqual(await readArchitectureFile(file), m);
  const first = path.join(file + '.history', encoded.archive.head + '.json');
  const firstBytes = await fs.readFile(first);
  await archiveProjectFile(file);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), encoded);
  const next = await updateProjectFile(file, projectContext(m, [m.root]), {
    put: [{ ...get(m, 'row-limit'), rule: 'Changed limit.' }],
  });
  assert.deepEqual(await readArchitectureFile(file), next);
  assert.deepEqual(await fs.readFile(first), firstBytes);
  assert.equal((await fs.readdir(file + '.history')).length, 2);
  const receipt = path.join(directory, 'receipt.json');
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [
        'src/cli.mjs',
        'context',
        file,
        '--focus',
        'implement-export',
        '--output',
        receipt,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(output.receipt, receipt);
  assert(!output.reads);
  assert(JSON.parse(await fs.readFile(receipt)).reads['row-limit']);
  // Failure after publishing a segment leaves the previous root readable; retry reuses it.
  const updated = edit(next, 'row-limit', 'rule');
  await assert.rejects(
    storeProjectStorage(file, updated, next, true, async (target, contents) => {
      if (target === file) throw Error('simulated root failure');
      return writeAtomic(target, contents);
    }),
    /simulated/,
  );
  assert.deepEqual(await readArchitectureFile(file), next);
  await storeProjectStorage(file, updated, next, true, writeAtomic);
  assert.deepEqual(await readArchitectureFile(file), updated);
  const corrupt = JSON.parse(firstBytes);
  corrupt.history[0].record.title += ' tampered';
  await fs.writeFile(first, JSON.stringify(corrupt));
  await assert.rejects(readArchitectureFile(file), { code: 'ARCHIVE_DIGEST' });
  await fs.writeFile(first, firstBytes);
  await fs.rm(first);
  await assert.rejects(readArchitectureFile(file), { code: 'ENOENT' });
  await fs.symlink(file, first);
  await assert.rejects(readArchitectureFile(file), { code: 'ARCHIVE_PATH' });
});

test('scoped check reviews never make results portable to a different full contract', () => {
  const m = review(structuredClone(example));
  const result = {
    key: 'recorded-run',
    type: 'result',
    title: 'Run',
    scope: m.root,
    check: 'export-check',
    outcome: 'pass',
    basis: { contract: contractDigest(m) },
    realization: realizationDigest(m),
    evidence: [{ path: 'run.json', digest: 'a'.repeat(64) }],
    resolves: [],
  };
  const recorded = apply(m, { put: [result] });
  assert.equal(
    analyzeProject(recorded).freshness['recorded-run'].current,
    true,
  );
  const changed = edit(recorded, 'row-limit', 'title');
  const analysis = analyzeProject(changed, {
    verifiedResults: ['recorded-run'],
  });
  assert.equal(analysis.freshness['export-check'].current, true);
  assert.equal(analysis.freshness['recorded-run'].current, false);
  assert.equal(analysis.completion['export-check'].implemented, false);
});

test('scoped bases must match the preserved source snapshot, including after unrelated edits', () => {
  const m = review(structuredClone(example));
  const missing = structuredClone(m);
  get(missing, 'implement-export').basis.contract = 'f'.repeat(64);
  assert(
    validateProject(missing).diagnostics.some(
      (d) => d.code === 'BASIS_SNAPSHOT_MISSING',
    ),
  );
  const stale = edit(m, 'row-limit', 'rule');
  assert.equal(validateProject(stale).valid, true);
  const forged = structuredClone(stale);
  const oldTask = get(forged, 'implement-export');
  forged.history.push({
    digest: digest(oldTask),
    record: structuredClone(oldTask),
  });
  get(forged, 'implement-export').basis.dependencies = dependencyDigest(
    forged,
    'implement-export',
  );
  assert(
    validateProject(forged).diagnostics.some(
      (d) => d.code === 'BASIS_DEPENDENCIES_MISMATCH',
    ),
  );
});
