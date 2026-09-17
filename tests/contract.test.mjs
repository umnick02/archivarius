// A version is a promise, so a contract change has to be gradeable before it is
// released: additive changes are what a minor may carry, and everything else is a
// major. The grader reads two schemas and says which it is, naming every
// difference; it never hardcodes the shape of the schema it grades.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertContractSupported,
  contractShape,
  contractVersion,
  gradeContract,
  supportedContractVersion,
} from '../src/model/contract.mjs';
import { parseArchitecture } from '../src/model/parse.mjs';

const root = new URL('../', import.meta.url);
const readSchema = async (name) =>
  JSON.parse(await fs.readFile(new URL('assets/' + name, root), 'utf8'));
const clone = (value) => structuredClone(value);
const kinds = (report) => report.changes.map((change) => change.kind).sort();
const thrown = (read) => {
  try {
    read();
  } catch (failure) {
    return failure;
  }
  return null;
};

const demo = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Demo',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'records'],
  properties: {
    version: { const: 2 },
    records: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/record' },
    },
  },
  $defs: {
    text: { type: 'string', minLength: 1, maxLength: 120 },
    record: {
      type: 'object',
      required: ['key', 'type'],
      unevaluatedProperties: false,
      properties: {
        key: { $ref: '#/$defs/text' },
        type: { type: 'string' },
        label: { $ref: '#/$defs/text' },
      },
      oneOf: [
        {
          properties: {
            type: { const: 'note' },
            body: { $ref: '#/$defs/text' },
          },
          required: ['type', 'body'],
        },
        {
          properties: {
            type: { const: 'link' },
            target: { $ref: '#/$defs/text' },
            weight: { enum: ['strong', 'weak'] },
          },
          required: ['type', 'target'],
        },
      ],
    },
  },
});

test('a contract shape names the version, the fields and the bounds a schema promises', () => {
  const shape = contractShape(demo());
  assert.equal(shape.title, 'Demo');
  assert.equal(shape.version, 2);
  const rootEntry = shape.locations[''];
  assert.deepEqual(rootEntry.required, ['records', 'version']);
  assert.equal(rootEntry.closed, true);
  assert.deepEqual(shape.locations['.records'].bounds, { minItems: 1 });
  assert.deepEqual(shape.locations['.records[]'], { ref: '#/$defs/record' });
  assert.deepEqual(shape.locations['$defs/text'], {
    types: ['string'],
    bounds: { minLength: 1, maxLength: 120 },
  });
});

test('each variant of a discriminated record is a shape of its own', () => {
  const shape = contractShape(demo());
  const note = shape.locations['$defs/record[type=note]'];
  const link = shape.locations['$defs/record[type=link]'];
  assert(note, 'the note variant is not described');
  assert(link, 'the link variant is not described');
  assert(note.required.includes('body'), 'body is required of a note');
  assert.deepEqual(note.optional, ['label'], 'a note carries no target');
  assert.deepEqual(link.optional, ['label', 'weight']);
  assert.deepEqual(
    shape.locations['$defs/record[type=link].weight'].values,
    ['strong', 'weak'],
    'the variant keeps its own value set',
  );
});

test('a new optional field, a new value and a looser bound grade as additive', () => {
  const next = demo();
  next.properties.note = { $ref: '#/$defs/text' };
  next.$defs.record.oneOf[1].properties.weight.enum.push('medium');
  next.properties.records.minItems = 0;
  next.$defs.text.maxLength = 200;
  const report = gradeContract(demo(), next);
  assert.equal(report.grade, 'additive');
  assert.deepEqual(report.breaking, []);
  assert.deepEqual(kinds(report), [
    'bound-relaxed',
    'bound-relaxed',
    'field-added',
    'shape-added',
    'value-added',
  ]);
});

test('a removed field, a newly required field, a removed value and a tighter bound grade as breaking', () => {
  const next = demo();
  delete next.$defs.record.properties.label;
  next.$defs.record.oneOf[1].required.push('weight');
  next.$defs.record.oneOf[1].properties.weight.enum = ['strong'];
  next.$defs.text.minLength = 2;
  const report = gradeContract(demo(), next);
  assert.equal(report.grade, 'breaking');
  assert(
    kinds(report).includes('field-removed'),
    'the dropped field is not reported',
  );
  assert(
    report.breaking.some((change) => change.kind === 'field-required'),
    'the newly required field is not reported',
  );
  assert(
    report.breaking.some(
      (change) =>
        change.kind === 'value-removed' && change.lost.includes('weak'),
    ),
    'the withdrawn value is not reported',
  );
  assert(
    report.breaking.some((change) => change.kind === 'bound-tightened'),
    'the tightened bound is not reported',
  );
});

test('a whole variant or definition that disappears is breaking, a new one is additive', () => {
  const dropped = demo();
  dropped.$defs.record.oneOf.pop();
  assert.equal(gradeContract(demo(), dropped).grade, 'breaking');
  const added = demo();
  added.$defs.record.oneOf.push({
    properties: { type: { const: 'aside' } },
    required: ['type'],
  });
  const report = gradeContract(demo(), added);
  assert.equal(report.grade, 'additive');
  assert(
    report.additive.some((change) => change.kind === 'shape-added'),
    'the new variant is not reported',
  );
});

test('a closed object that opens is additive and one that closes is breaking', () => {
  const opened = demo();
  delete opened.additionalProperties;
  assert.equal(gradeContract(demo(), opened).grade, 'additive');
  const closed = demo();
  closed.$defs.text.type = 'string';
  closed.properties.records.uniqueItems = true;
  assert.equal(gradeContract(demo(), closed).grade, 'breaking');
});

test('the shipped contracts grade as unchanged against themselves', async () => {
  for (const name of [
    'archivarius-model.schema.json',
    'archivarius-architecture.schema.json',
    'archivarius-change.schema.json',
  ]) {
    const schema = await readSchema(name);
    const report = gradeContract(schema, clone(schema));
    assert.deepEqual(report.changes, [], name);
    assert.equal(report.grade, 'unchanged', name);
  }
});

// The next release of the authored contract adds optional attribution fields, so
// the grader is held to that case on the real schema rather than a fixture: a new
// optional field is what a minor may carry, and nothing about the reading depends
// on the fields the schema happens to have today.
test('an optional field added to the shipped contract grades as additive', async () => {
  const schema = await readSchema('archivarius-model.schema.json');
  const next = clone(schema);
  const variant = next.$defs.record.oneOf.find(
    (branch) => branch.properties?.type?.const === 'decision',
  );
  variant.properties.attributedTo = { $ref: '#/$defs/text' };
  next.properties.attribution = { $ref: '#/$defs/text' };
  const report = gradeContract(schema, next);
  assert.equal(report.grade, 'additive');
  assert.deepEqual(report.breaking, []);
  assert.deepEqual(kinds(report), [
    'field-added',
    'field-added',
    'shape-added',
    'shape-added',
  ]);
});

test('the shipped contracts describe every record type as a shape of its own', async () => {
  const shape = contractShape(
    await readSchema('archivarius-model.schema.json'),
  );
  assert.equal(shape.version, supportedContractVersion);
  const markdown =
    shape.locations['$defs/record[type=document][format=markdown]'];
  assert(markdown, 'the markdown document variant is not described');
  assert(
    markdown.required.includes('blocks'),
    'a markdown document has blocks',
  );
  assert(
    !shape.locations[
      '$defs/record[type=document][format=json]'
    ].required.includes('blocks'),
    'a json document must not require blocks',
  );
});

test('a contract version is read from a schema, a model or a number', async () => {
  assert.equal(
    contractVersion(await readSchema('archivarius-model.schema.json')),
    4,
  );
  assert.equal(
    contractVersion(await readSchema('archivarius-architecture.schema.json')),
    3,
  );
  assert.equal(contractVersion({ version: 9 }), 9);
  assert.equal(contractVersion(7), 7);
  assert.equal(contractVersion({ version: 'four' }), null);
  assert.equal(contractVersion(null), null);
});

test('a snapshot from a newer contract major is refused by name', () => {
  const failure = thrown(() => assertContractSupported({ version: 5 }, 4));
  assert.equal(failure.code, 'CONTRACT_TOO_NEW');
  assert.match(failure.message, /CONTRACT_TOO_NEW/);
  assert.deepEqual(failure.diagnostics, [
    {
      code: 'CONTRACT_TOO_NEW',
      path: '/version',
      field: 'version',
      value: '5',
      expected: 'A contract version this library reads, at most 4.',
    },
  ]);
  assert.equal(assertContractSupported({ version: 4 }, 4), 4);
  assert.equal(assertContractSupported({ version: 1 }, 4), 1);
  assert.equal(assertContractSupported({}, 4), null);
  assert.equal(
    assertContractSupported({ version: supportedContractVersion }),
    supportedContractVersion,
  );
});

test('reading a model from a newer contract major stops at the version, not at every field it cannot read', () => {
  const failure = thrown(() =>
    parseArchitecture(JSON.stringify({ version: 5, nodes: [], relations: [] })),
  );
  assert.equal(failure.code, 'CONTRACT_TOO_NEW');
  assert.equal(failure.diagnostics[0].value, '5');
});
