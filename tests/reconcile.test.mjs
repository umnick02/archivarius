// A description of a relation is an assertion; the dependency the code has is a
// fact. This suite holds the reconciliation of the two: a declared relation the
// code no longer has, a dependency the code has that nobody declared, and — the
// honest third answer — the edges and relations it cannot judge at all, because a
// digest proves a file has not moved, never that it still does what a record says.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileArchitecture } from '../src/model/reconcile.mjs';
import { observeImports } from '../src/model/imports.mjs';
import { clone } from './project-fixture.mjs';

// The compact project, with one file bound to each component so its relations can
// be judged at all: screen -> admission -> writer, and admission -> screen.
const bound = (paths) => {
  const model = clone();
  model.bindings = Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [
      key,
      { path, digest: 'a'.repeat(64) },
    ]),
  );
  return model;
};

const parts = {
  screen: 'src/screen.mjs',
  admission: 'src/admission.mjs',
  writer: 'src/writer.mjs',
};

const named = (entries) =>
  entries.map((entry) => entry.relation ?? entry.from + ' -> ' + entry.to);

test('a declared relation the code really has is confirmed', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  assert.deepEqual(named(report.confirmed).sort(), [
    'accepted',
    'completed',
    'rejected',
    'request',
  ]);
  assert.deepEqual(report.absent, []);
  assert.deepEqual(report.undeclared, []);
  assert.deepEqual(report.unjudged, []);
});

test('a declared relation the code no longer has is reported absent', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  assert.deepEqual(report.absent, [
    {
      relation: 'accepted',
      from: 'admission',
      to: 'writer',
      fromPath: 'src/admission.mjs',
      toPath: 'src/writer.mjs',
    },
  ]);
});

test('a relation held through a file no part describes is still confirmed', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/helper.mjs' },
    { from: 'src/helper.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  assert.ok(named(report.confirmed).includes('request'));
  assert.deepEqual(report.absent, []);
});

test('a dependency that only passes through another part is not that part\u2019s relation', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  // admission reaches screen only by way of writer, which is a described part,
  // so the dependency belongs to writer and the declared edge is absent.
  assert.deepEqual(named(report.absent), ['rejected']);
});

test('a dependency the code has that no relation declares is reported', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
    { from: 'src/screen.mjs', to: 'src/writer.mjs' },
  ]);
  assert.deepEqual(report.undeclared, [
    {
      from: 'screen',
      to: 'writer',
      fromPath: 'src/screen.mjs',
      toPath: 'src/writer.mjs',
    },
  ]);
});

test('a dependency that runs against a declared relation is undeclared in the direction it has', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/writer.mjs', to: 'src/admission.mjs' },
  ]);
  assert.deepEqual(named(report.undeclared), ['writer -> admission']);
  assert.ok(named(report.absent).includes('accepted'));
});

test('a relation between two parts no file carries is unjudged, never absent', () => {
  const report = reconcileArchitecture(clone(), []);
  assert.deepEqual(report.absent, []);
  assert.deepEqual(named(report.unjudged).sort(), [
    'accepted',
    'completed',
    'rejected',
    'request',
  ]);
  assert.deepEqual(
    [...new Set(report.unjudged.map((entry) => entry.reason))],
    ['endpoints-unbound'],
  );
});

test('a relation with one unbound end names the end that cannot be read', () => {
  const report = reconcileArchitecture(
    bound({ screen: parts.screen, admission: parts.admission }),
    [{ from: 'src/screen.mjs', to: 'src/admission.mjs' }],
  );
  assert.deepEqual(
    report.unjudged.map((entry) => [entry.relation, entry.reason]),
    [
      ['accepted', 'target-unbound'],
      ['completed', 'source-unbound'],
    ],
  );
});

test('two parts carried by one file cannot be told apart, so their relation is unjudged', () => {
  const report = reconcileArchitecture(
    bound({ ...parts, writer: parts.admission }),
    [{ from: 'src/screen.mjs', to: 'src/admission.mjs' }],
  );
  assert.deepEqual(
    report.unjudged.map((entry) => [entry.relation, entry.reason]),
    [['accepted', 'shared-file']],
  );
  // completed (writer -> screen) is still judgeable: it reads as a relation out
  // of the shared file, and the code has no such dependency.
  assert.deepEqual(named(report.absent), ['completed', 'rejected']);
});

test('an edge out of a file no part carries is unattributed, not undeclared', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/loose.mjs', to: 'src/admission.mjs' },
  ]);
  assert.deepEqual(report.undeclared, []);
  assert.deepEqual(report.unattributed, [
    {
      from: 'src/loose.mjs',
      to: 'src/admission.mjs',
      reason: 'source-unknown',
    },
  ]);
});

test('an edge into a package the model never describes is unattributed', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'react' },
    { from: 'src/loose.mjs', to: 'elkjs' },
  ]);
  assert.deepEqual(report.unattributed, [
    { from: 'src/loose.mjs', to: 'elkjs', reason: 'endpoints-unknown' },
    { from: 'src/screen.mjs', to: 'react', reason: 'target-unknown' },
  ]);
});

test('a file bound to a part that is not a component attributes nothing', () => {
  const model = bound(parts);
  model.bindings['request-contract'] = {
    path: 'src/contract.mjs',
    digest: 'a'.repeat(64),
  };
  const report = reconcileArchitecture(model, [
    { from: 'src/contract.mjs', to: 'src/screen.mjs' },
  ]);
  assert.deepEqual(report.undeclared, []);
  assert.deepEqual(named(report.unattributed), [
    'src/contract.mjs -> src/screen.mjs',
  ]);
});

test('every declared relation is answered exactly once', () => {
  const report = reconcileArchitecture(bound(parts), [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
  ]);
  const answered = [
    ...named(report.confirmed),
    ...named(report.absent),
    ...named(report.unjudged),
  ];
  assert.deepEqual(answered.sort(), [
    'accepted',
    'completed',
    'rejected',
    'request',
  ]);
});

// The oracle: this repository's own description, reconciled against this
// repository's own import graph. The report has to be readable, so it is printed.
test('the real project reconciles against the real src/ import graph', async () => {
  const model = JSON.parse(
    await fs.readFile(new URL('../project.json', import.meta.url), 'utf8'),
  );
  const root = new URL('../src/', import.meta.url);
  const modules = [];
  for (const file of await fs.readdir(root, { recursive: true })) {
    if (!/\.(?:mjs|jsx)$/.test(file)) continue;
    modules.push({
      path: 'src/' + file,
      text: await fs.readFile(new URL(file, root), 'utf8'),
    });
  }
  const report = reconcileArchitecture(model, observeImports(modules));
  const show = (title, entries) =>
    console.log(
      title +
        ' (' +
        entries.length +
        ')' +
        entries
          .map(
            (entry) =>
              '\n  ' +
              (entry.relation ? entry.relation + ': ' : '') +
              entry.from +
              ' -> ' +
              entry.to +
              (entry.reason ? ' [' + entry.reason + ']' : ''),
          )
          .join(''),
    );
  show('confirmed', report.confirmed);
  show('absent', report.absent);
  show('undeclared', report.undeclared);
  show('unjudged', report.unjudged);
  show('unattributed', report.unattributed);
  const declared = model.records.filter((r) => r.type === 'interaction').length;
  assert.equal(
    report.confirmed.length + report.absent.length + report.unjudged.length,
    declared,
  );
  assert.ok(report.confirmed.length, 'no described relation was confirmed');
  assert.ok(report.unattributed.length, 'the report claims no blind spot');
});

// A part that rests on several files is reached through any of them: the claim is
// about the lines, so attribution follows every file the binding names.
test('a part bound to several files is reached through each of them', () => {
  const model = bound(parts);
  model.bindings.admission = {
    parts: [
      { path: 'src/admission.mjs', digest: 'a'.repeat(64) },
      { path: 'src/rules.mjs', digest: 'b'.repeat(64) },
    ],
  };
  const report = reconcileArchitecture(model, [
    { from: 'src/screen.mjs', to: 'src/rules.mjs' },
    { from: 'src/rules.mjs', to: 'src/writer.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  assert.deepEqual(named(report.confirmed).sort(), [
    'accepted',
    'completed',
    'rejected',
    'request',
  ]);
  assert.deepEqual(report.absent, []);
  assert.deepEqual(report.undeclared, []);
});

// A part reaching its own container is inside it, not across it: containment is
// already stated by the parent, so it is reported apart from a relation nobody
// declared - named, never silent.
test('a dependency on a containing part is containment, not an undeclared relation', () => {
  const model = bound(parts);
  model.records.find((r) => r.key === 'writer').parent = 'admission';
  const report = reconcileArchitecture(model, [
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/writer.mjs', to: 'src/admission.mjs' },
  ]);
  assert.deepEqual(
    named(report.contained),
    ['writer -> admission'],
    JSON.stringify(report.contained),
  );
  assert.deepEqual(report.undeclared, []);
});

// The contract forbids a relation whose end is a group, so a dependency out of a
// container's own file cannot be declared at all. Reporting it as undeclared
// would ask for a record the model is not allowed to hold, so it is answered as
// undeclarable and named.
test('a dependency whose end is a container cannot be declared, and says so', () => {
  const model = bound({ ...parts, export: 'src/export.mjs' });
  const report = reconcileArchitecture(model, [
    { from: 'src/export.mjs', to: 'src/screen.mjs' },
    { from: 'src/screen.mjs', to: 'src/admission.mjs' },
    { from: 'src/admission.mjs', to: 'src/writer.mjs' },
    { from: 'src/admission.mjs', to: 'src/screen.mjs' },
    { from: 'src/writer.mjs', to: 'src/screen.mjs' },
  ]);
  assert.deepEqual(
    report.undeclarable.map(
      (edge) => edge.from + ' -> ' + edge.to + ' ' + edge.reason,
    ),
    ['export -> screen source-is-group'],
    JSON.stringify(report.undeclarable),
  );
  assert.deepEqual(report.undeclared, []);
});
