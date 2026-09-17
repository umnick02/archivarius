import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openQuestions } from '../src/model/project-questions.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { clone, get } from './project-fixture.mjs';

const copy = JSON.parse(
  await fs.readFile(new URL('../assets/project.json', import.meta.url), 'utf8'),
);
// A question is a record of the contract, so the fixture states one the way a
// model does rather than inventing a shape the schema would reject.
const asking = (key, statement) => ({
  key,
  type: 'source',
  title: statement,
  scope: 'project',
  origin: 'question',
  statement,
});
const withQuestions = () => {
  const model = clone();
  const owner = model.records.find((r) => r.type === 'source');
  assert(owner, 'the fixture must already carry a source');
  model.records.push(
    asking('who-owns-retention', 'Who owns the retention window?'),
    { ...asking('cache-shape', 'Is the cache per reader or shared?') },
    { ...owner, key: 'guessed-limit', origin: 'assumption' },
    { ...owner, key: 'seen-limit', origin: 'observation' },
  );
  return model;
};

test('every question-origin source is an open question and no other origin is', () => {
  const model = withQuestions();
  assert.deepEqual(
    openQuestions(model).map((q) => q.key),
    ['who-owns-retention', 'cache-shape'],
  );
  for (const question of openQuestions(model))
    assert.equal(question.origin, 'question');
  assert.equal(
    openQuestions(model)[0].statement,
    'Who owns the retention window?',
  );
  assert.equal(openQuestions(model)[0].scope, 'project');
});

test('a project that asks nothing has an empty open list rather than no list', () => {
  const model = clone();
  assert.deepEqual(openQuestions(model), []);
  assert.deepEqual(openQuestions({ records: [] }), []);
});

test('an answered question leaves the open list when it leaves the records', () => {
  const model = withQuestions();
  const asked = model.records.find((r) => r.key === 'cache-shape');
  model.records = model.records.filter((r) => r.key !== 'cache-shape');
  model.history = [...model.history, { digest: 'a'.repeat(64), record: asked }];
  assert.deepEqual(
    openQuestions(model).map((q) => q.key),
    ['who-owns-retention'],
  );
});

test('reading the open list never rewrites the project it reads', () => {
  const model = withQuestions();
  const before = JSON.stringify(model);
  openQuestions(model);
  assert.equal(JSON.stringify(model), before);
  assert.equal(validateProject(withQuestions()).valid, true);
});

test('the project copy names the open list, its note and its empty state', () => {
  for (const key of ['openQuestions', 'openQuestionsNote', 'noOpenQuestions'])
    assert.equal(
      typeof copy[key],
      'string',
      'assets/project.json needs ' + key,
    );
  assert.equal(copy.values.question, 'Open question');
  assert.equal(typeof get(clone(), 'project').purpose, 'string');
});
