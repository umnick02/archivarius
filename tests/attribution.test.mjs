// A claim has an age and an author. The receipt that accepted a record already
// says what it was written against; these cases hold it to saying when it was
// written and by whom, and hold the ageing verdict to a life the model states
// rather than a number this suite invents. Ageing is read against a given
// instant, never a clock, so every case here names its own "now".
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject } from '../src/model/project-contract.mjs';
import { contractDigest } from '../src/model/project-digest.mjs';
import { claimStanding } from '../src/model/project-view.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import { get, ready } from './project-fixture.mjs';

const day = 86400000;
const at = (offset) => new Date(Date.parse('2026-01-01T00:00:00Z') + offset);
const written = at(0).toISOString();
const now = (days) => at(days * day).toISOString();

// One sealed fixture, then one attributed claim inside it: the task record is
// the claim under test everywhere below.
const attributed = (attribution = {}, over = {}) => {
  const model = ready();
  const task = get(model, 'implement-export');
  task.basis = { contract: contractDigest(model), ...attribution };
  Object.assign(get(model, model.root), over);
  return model;
};

test('the contract accepts a claim that records when it was written, by whom and for how long', () => {
  const model = attributed(
    { at: written, by: 'K. Tatsevasian', life: 30 },
    { claimLife: 90 },
  );
  const report = validateProject(model);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.valid, true);
});

// Every field is the contract's to add, so a receipt that records none of them
// is still a receipt.
test('a claim that records no attribution at all still validates', () => {
  assert.equal(validateProject(attributed()).valid, true);
});

test('the contract refuses an instant that is not a date and time, and a life that is not whole days', () => {
  for (const attribution of [
    { at: 'yesterday' },
    { at: '2026-01-01' },
    { by: '   ' },
    { life: 0 },
    { life: 1.5 },
  ])
    assert.equal(
      validateProject(attributed(attribution)).valid,
      false,
      JSON.stringify(attribution) + ' was accepted',
    );
  assert.equal(validateProject(attributed({}, { claimLife: 0 })).valid, false);
});

test('a claim states its author and the day it was written', () => {
  const model = attributed({ at: written, by: 'K. Tatsevasian', life: 30 });
  const standing = claimStanding(model, 'implement-export', now(10));
  assert.equal(standing.author, 'K. Tatsevasian');
  assert.equal(standing.writtenAt, written);
  assert.equal(standing.age, 10);
  assert.equal(standing.life, 30);
  assert.equal(standing.ageing, false);
  assert.equal(standing.past, 0);
});

test('a claim older than its stated life reads as ageing, and says by how much', () => {
  const model = attributed({ at: written, by: 'A', life: 30 });
  const standing = claimStanding(model, 'implement-export', now(45));
  assert.equal(standing.ageing, true);
  assert.equal(standing.age, 45);
  assert.equal(standing.past, 15);
  // The life is stated, not hardcoded: the same claim under a longer life is
  // not ageing at the same instant.
  const longer = attributed({ at: written, by: 'A', life: 60 });
  assert.equal(
    claimStanding(longer, 'implement-export', now(45)).ageing,
    false,
  );
});

test('the stated life comes from the record, or from the nearest scope that states one', () => {
  const project = {
    root: 'top',
    records: [
      { key: 'top', type: 'scope', title: 'Top', claimLife: 90 },
      { key: 'middle', type: 'scope', title: 'Middle', parent: 'top' },
      { key: 'inner', type: 'scope', title: 'Inner', parent: 'middle' },
      {
        key: 'own',
        type: 'task',
        title: 'Own',
        scope: 'inner',
        basis: { contract: 'a', at: written, by: 'A', life: 7 },
      },
      {
        key: 'inherited',
        type: 'task',
        title: 'Inherited',
        scope: 'inner',
        basis: { contract: 'a', at: written, by: 'A' },
      },
    ],
    history: [],
  };
  const own = claimStanding(project, 'own', now(10));
  assert.equal(own.life, 7);
  assert.equal(own.lifeStatedBy, 'own');
  assert.equal(own.ageing, true);
  const inherited = claimStanding(project, 'inherited', now(10));
  assert.equal(inherited.life, 90);
  assert.equal(inherited.lifeStatedBy, 'top');
  assert.equal(inherited.ageing, false);
});

test('a claim with no stated life, no recorded instant or no instant to read against never ages', () => {
  const noLife = attributed({ at: written, by: 'A' });
  const open = claimStanding(noLife, 'implement-export', now(4000));
  assert.equal(open.life, null);
  assert.equal(open.ageing, false);
  assert.equal(open.age, 4000);
  assert.equal(open.past, null);
  const noInstant = attributed({ by: 'A', life: 1 });
  const undated = claimStanding(noInstant, 'implement-export', now(10));
  assert.equal(undated.writtenAt, null);
  assert.equal(undated.age, null);
  assert.equal(undated.ageing, false);
  const dated = attributed({ at: written, by: 'A', life: 1 });
  const unread = claimStanding(dated, 'implement-export');
  assert.equal(unread.age, null);
  assert.equal(unread.ageing, false);
  assert.equal(unread.life, 1);
});

test('a record that carries no claim at all reads as no claim, and an unknown key as none', () => {
  const model = attributed();
  const component = claimStanding(model, 'screen', now(1));
  assert.equal(component.claimed, false);
  assert.equal(component.author, null);
  assert.equal(claimStanding(model, 'nothing-here', now(1)), null);
});

test('the freshness report shows an aged claim as ageing rather than as current', () => {
  const model = attributed({ at: written, by: 'A', life: 30 });
  const fresh = analyzeProject(model, { now: now(10) });
  assert.equal(fresh.freshness['implement-export'].current, true);
  const aged = analyzeProject(model, { now: now(45) });
  const entry = aged.freshness['implement-export'];
  assert.equal(entry.current, false);
  assert.deepEqual(entry.reasons, [
    { code: 'CLAIM_AGEING', key: 'implement-export' },
  ]);
});

// No pure computation may read a clock: with no instant to read against there is
// no age, so the report is the same one it was before attribution existed.
test('the freshness report never ages a claim against a clock of its own', () => {
  const model = attributed({ at: written, by: 'A', life: 1 });
  const report = analyzeProject(model);
  assert.equal(report.freshness['implement-export'].current, true);
  assert.deepEqual(report.freshness['implement-export'].reasons, []);
});
