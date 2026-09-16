import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject } from '../src/project.mjs';
import { confirmationGroups, searchRecord } from '../src/project-view.mjs';

const project = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/project.json', import.meta.url),
    'utf8',
  ),
);
const copy = JSON.parse(
  await fs.readFile(new URL('../assets/project.json', import.meta.url), 'utf8'),
);
const get = (key) => project.records.find((r) => r.key === key);

test('search finds parameter values, methods, nested content and reference titles', () => {
  assert.equal(
    searchRecord(project, get('row-limit'), ' 1000 ', copy).text,
    '1000',
  );
  const check = get('export-check');
  assert.equal(
    searchRecord(project, check, check.method, copy).text,
    check.method,
  );
  assert(
    searchRecord(project, get('within-limit'), get('row-limit').title, copy),
  );
  const record = structuredClone(get('row-limit'));
  record.parameters.nested = { toString: 17 };
  assert.equal(searchRecord(project, record, '17', copy).text, '17');
  assert.equal(searchRecord(project, record, 'never-present', copy), undefined);
});

test('search excludes technical receipts and displays the actual matching field', () => {
  const record = {
    ...get('export-check'),
    basis: { contract: 'a'.repeat(64) },
  };
  assert.equal(
    searchRecord(project, record, record.basis.contract, copy),
    undefined,
  );
  assert.equal(
    searchRecord(project, get('row-limit'), '1000', copy).field,
    `${copy.fields.parameters} · maxRows`,
  );
});

test('grouping retains all blockers, shared areas and the original conclusion', () => {
  const before = JSON.stringify(project);
  const analysis = analyzeProject(project);
  const reasons = analysis.completion[project.root].reasons;
  const groups = confirmationGroups(project, reasons);
  const retained = groups
    .flatMap((g) => [...g.keys].map((key) => `${g.code}:${key}`))
    .sort();
  assert.deepEqual(
    retained,
    [...new Set(reasons.map((r) => `${r.code}:${r.key}`))].sort(),
  );
  for (const group of groups)
    assert.deepEqual(
      new Set([...group.areas.values()].flatMap((keys) => [...keys])),
      group.keys,
    );
  const shared = confirmationGroups(project, [
    { code: 'CRITERIA_MISSING', key: 'result-contract' },
  ])[0];
  assert.deepEqual(new Set(shared.areas.keys()), new Set(['screen', 'export']));
  assert.equal(JSON.stringify(project), before);
  assert.equal(analysis.completion[project.root].implemented, false);
});

test('historical failures remain navigable with their archived scope', () => {
  const model = structuredClone(project);
  model.history.push({
    digest: 'a'.repeat(64),
    record: {
      key: 'old-run',
      type: 'result',
      scope: project.root,
      title: get('export-check').title,
    },
  });
  const [group] = confirmationGroups(model, [
    { code: 'CHECK_FAILED', key: 'old-run' },
  ]);
  assert(group.areas.get(project.root).has('old-run'));
});
