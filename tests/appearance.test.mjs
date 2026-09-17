import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeAppearance,
  relationAppearance,
  nodeShapes,
  zoneTones,
  relationTones,
  relationLines,
  rootTones,
} from '../src/model/appearance.mjs';
import { shapeRadii } from '../src/ui/view.mjs';

const schema = JSON.parse(
  await fs.readFile(
    new URL('../assets/architecture.schema.json', import.meta.url),
    'utf8',
  ),
);
const nodeEnum = (field) =>
  schema.$defs.nodeFields.properties[field].enum.slice();
const relationEnum = schema.$defs.relationFields.properties.kind.enum.slice();

// The appearance table is keyed on the rendering contract's closed enums, so a
// value the schema allows can never reach a renderer without a display token.
test('every contract value the map can carry has exactly one display token', () => {
  assert.deepEqual(Object.keys(zoneTones).sort(), nodeEnum('zone').sort());
  assert.deepEqual(Object.keys(nodeShapes).sort(), nodeEnum('kind').sort());
  assert.deepEqual(Object.keys(relationTones).sort(), relationEnum.sort());
  assert.deepEqual(Object.keys(relationLines).sort(), relationEnum.sort());
});

test('appearance answers with a tone, a shape and an outline for any allowed node', () => {
  for (const kind of nodeEnum('kind'))
    for (const zone of nodeEnum('zone')) {
      const look = nodeAppearance({ kind, zone });
      assert.match(look.tone, /^#[0-9a-f]{6}$/);
      // An outside participant is drawn as a broken line, everything the model
      // owns as an unbroken one.
      assert.equal(look.outline, kind === 'external' ? 'dashed' : 'solid');
    }
});

test('a store and an external participant do not draw as a plain component', () => {
  const shapes = new Set(Object.values(nodeShapes));
  assert(shapes.has(nodeShapes.store), 'a store has no shape');
  assert.notEqual(nodeShapes.store, nodeShapes.component);
  assert.notEqual(nodeShapes.external, nodeShapes.component);
  assert.notEqual(nodeShapes.store, nodeShapes.external);
});

// A named shape only exists if a renderer can draw it, so the surface that owns
// the pixels answers for every shape the table names — no silent fallback.
test('every shape the table names has pixels to be drawn with', () => {
  for (const kind of nodeEnum('kind')) {
    const { shape } = nodeAppearance({ kind, zone: 'pure' });
    assert.equal(
      typeof shapeRadii[shape],
      'function',
      'no pixels for shape ' + shape,
    );
    assert.match(shapeRadii[shape](200, 120), /px/);
  }
});

test('appearance answers with a tone and a line for any allowed relation', () => {
  const tones = new Set(),
    lines = new Set();
  for (const kind of relationEnum) {
    const look = relationAppearance({ kind });
    assert.match(look.tone, /^#[0-9a-f]{6}$/);
    assert(
      ['solid', 'thick', 'dotted'].includes(look.line),
      'unknown line ' + look.line,
    );
    tones.add(look.tone);
    lines.add(look.line);
  }
  // Two kinds that read alike carry no information.
  assert.equal(tones.size, relationEnum.length);
  assert.equal(lines.size, relationEnum.length);
});

// The container tone says which root a card belongs to and the zone tone says
// what kind of work it does. If the two sequences shared a colour, a border
// could read as a zone the card is not in.
test('the container sequence never repeats a zone tone', () => {
  const zones = new Set(Object.values(zoneTones));
  for (const tone of rootTones) {
    assert.match(tone, /^#[0-9a-f]{6}$/);
    assert(!zones.has(tone), 'container tone ' + tone + ' is a zone tone');
  }
  assert.equal(new Set(rootTones).size, rootTones.length);
});

test('an unknown value is rejected instead of drawn as a default', () => {
  assert.throws(() => nodeAppearance({ kind: 'component', zone: 'nowhere' }));
  assert.throws(() => nodeAppearance({ kind: 'widget', zone: 'pure' }));
  assert.throws(() => relationAppearance({ kind: 'ping' }));
});

// One vocabulary, two renderers: the browser owns pixels, never a second copy
// of the palette the readme diagram draws with — the stylesheet included.
test('the browser surface holds no second copy of the shared palette', async () => {
  const shared = new Set([
    ...Object.values(zoneTones),
    ...Object.values(relationTones),
  ]);
  const directory = new URL('../src/ui/', import.meta.url);
  for (const name of await fs.readdir(directory)) {
    if (!/\.(mjs|jsx|css)$/.test(name)) continue;
    const source = await fs.readFile(new URL(name, directory), 'utf8');
    for (const tone of shared)
      assert(
        !source.toLowerCase().includes(tone),
        'src/ui/' + name + ' repeats the shared tone ' + tone,
      );
  }
});
