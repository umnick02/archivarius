// A refusal is a reading the reader can act on. `model/failure.mjs` turns a
// raised `ArchitectureError` into the statements a surface prints: the code, what
// the catalogue says it means and how to answer it, and one statement per
// diagnostic naming the record, the field, what was read and what was expected.
// It invents no English and hides no code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchitectureError, failureCodes } from '../src/model/errors.mjs';
import { failureReport } from '../src/model/failure.mjs';

const diagnostic = {
  code: 'UNKNOWN_NODE',
  path: '/relations/2/to',
  record: 'ghost',
  field: 'to',
  value: 'the string "ghost"',
  expected: 'The key of a part the model declares.',
};

test('a catalogued code is reported with what the catalogue states', () => {
  const report = failureReport(
    new ArchitectureError(
      'INVALID_MODEL',
      ['UNKNOWN_NODE:ghost'],
      [diagnostic],
    ),
  );
  assert.equal(report.code, 'INVALID_MODEL');
  assert.equal(report.catalogued, true);
  assert.equal(report.meaning, failureCodes.INVALID_MODEL.meaning);
  assert.equal(report.remedy, failureCodes.INVALID_MODEL.remedy);
  assert.equal(report.meaning.length > 0, true);
  assert.equal(report.remedy.length > 0, true);
});

test('every diagnostic becomes one statement, losing nothing it stated', () => {
  const report = failureReport(
    new ArchitectureError('INVALID_MODEL', [], [diagnostic]),
  );
  assert.equal(report.statements.length, 1);
  assert.deepEqual(report.statements[0], {
    code: 'UNKNOWN_NODE',
    path: '/relations/2/to',
    record: 'ghost',
    field: 'to',
    value: 'the string "ghost"',
    expected: 'The key of a part the model declares.',
    catalogued: true,
  });
});

test('a statement keeps its own code and its own place in the catalogue', () => {
  const report = failureReport(
    new ArchitectureError(
      'INVALID_MODEL',
      [],
      [diagnostic, { ...diagnostic, code: 'NOT_A_REAL_CODE', record: 'other' }],
    ),
  );
  assert.deepEqual(
    report.statements.map((statement) => statement.code),
    ['UNKNOWN_NODE', 'NOT_A_REAL_CODE'],
  );
  // The report says which statements the catalogue can explain, so the surface
  // never prints a blank meaning as though it were the meaning.
  assert.deepEqual(
    report.statements.map((statement) => statement.catalogued),
    [true, false],
  );
});

test('an issue naming a subject is split into its code and its subject', () => {
  const report = failureReport(
    new ArchitectureError(
      'INVALID_MODEL',
      ['UNKNOWN_NODE:ghost', 'ENTRY_REQUIRED'],
      [],
    ),
  );
  assert.deepEqual(report.issues, [
    { code: 'UNKNOWN_NODE', subject: 'ghost' },
    { code: 'ENTRY_REQUIRED', subject: null },
  ]);
});

test('an uncatalogued code is reported as uncatalogued, never as silence', () => {
  const report = failureReport(
    new ArchitectureError('NOT_A_REAL_CODE', [], []),
  );
  assert.equal(report.code, 'NOT_A_REAL_CODE');
  assert.equal(report.catalogued, false);
  assert.equal(report.meaning, null);
  assert.equal(report.remedy, null);
});

test('a failure that is not ours still reports a code and its own words', () => {
  const report = failureReport(new TypeError('fetch failed'));
  assert.equal(report.code, 'TypeError');
  assert.equal(report.catalogued, false);
  assert.equal(report.message, 'fetch failed');
  assert.deepEqual(report.statements, []);
  assert.deepEqual(report.issues, []);
  // A thrown string is a failure too, and it is not allowed to crash the report.
  assert.equal(failureReport('boom').message, 'boom');
  assert.equal(failureReport(null), null);
  assert.equal(failureReport(undefined), null);
});

test('a code carried on a plain failure is preferred to its name', () => {
  const error = new Error('no route to host');
  error.code = 'ENOTFOUND';
  assert.equal(failureReport(error).code, 'ENOTFOUND');
});

test('the report is plain data a surface can hold as state', () => {
  const report = failureReport(
    new ArchitectureError(
      'INVALID_MODEL',
      ['UNKNOWN_NODE:ghost'],
      [diagnostic],
    ),
  );
  assert.deepEqual(structuredClone(report), report);
  assert.equal(Object.hasOwn(report, 'issues'), true);
  assert.equal(Object.hasOwn(report, 'statements'), true);
});

// The catalogue is the only source of English about a code, and the report reads
// every entry of it the same way.
test('every catalogued code can be reported', () => {
  for (const code of Object.keys(failureCodes)) {
    const report = failureReport(new ArchitectureError(code, [], []));
    assert.equal(report.code, code);
    assert.equal(report.catalogued, true, code + ' is not catalogued');
    assert.equal(typeof report.meaning, 'string');
    assert.equal(typeof report.remedy, 'string');
  }
});
