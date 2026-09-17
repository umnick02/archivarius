import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeAppearance,
  relationAppearance,
  nodeShapes,
  nodeOutlines,
  nodeTags,
  zoneTags,
  zoneTones,
  relationTags,
  relationTones,
  relationLines,
  rootTones,
  drawnEnums,
} from '../src/model/appearance.mjs';
import { shapeRadii } from '../src/ui/view.mjs';

const read = async (name) =>
  JSON.parse(
    await fs.readFile(new URL('../assets/' + name, import.meta.url), 'utf8'),
  );
const schema = await read('archivarius-architecture.schema.json');
const nodeEnum = (field) =>
  schema.$defs.nodeFields.properties[field].enum.slice();
const relationEnum = schema.$defs.relationFields.properties.kind.enum.slice();

// The authoring contract states the same closed enums as the rendering one, and
// both are read here rather than copied: a value either schema gains has to
// reach the appearance table before this suite is green again.
const model = await read('archivarius-model.schema.json');
const branch = (type) =>
  model.$defs.record.oneOf.find((one) => one.properties?.type?.const === type);
const contractValues = {
  kind: branch('component').properties.kind.enum.slice(),
  zone: branch('component').properties.zone.enum.slice(),
  relation: branch('interaction').properties.kind.enum.slice(),
};

// The appearance table is keyed on the rendering contract's closed enums, so a
// value the schema allows can never reach a renderer without a display token.
test('every contract value the map can carry has exactly one display token', () => {
  assert.deepEqual(Object.keys(zoneTones).sort(), nodeEnum('zone').sort());
  assert.deepEqual(Object.keys(nodeShapes).sort(), nodeEnum('kind').sort());
  assert.deepEqual(Object.keys(nodeOutlines).sort(), nodeEnum('kind').sort());
  assert.deepEqual(Object.keys(relationTones).sort(), relationEnum.sort());
  assert.deepEqual(Object.keys(relationLines).sort(), relationEnum.sort());
});

// Both shipped schemas close the same enums; if they ever disagreed, one surface
// would draw a value the other cannot state.
test('the two shipped contracts close the same drawn enums', () => {
  assert.deepEqual(contractValues.kind.slice().sort(), nodeEnum('kind').sort());
  assert.deepEqual(contractValues.zone.slice().sort(), nodeEnum('zone').sort());
  assert.deepEqual(
    contractValues.relation.slice().sort(),
    relationEnum.slice().sort(),
  );
  assert.deepEqual(
    Object.keys(drawnEnums).sort(),
    Object.keys(contractValues).sort(),
  );
});

// Colour is not a channel on its own: a reader who cannot separate two hues, or
// who prints the page, still has to be able to read every value. So each drawn
// enum value carries at least one token that is not a tone.
test('no drawn contract value is carried by its tone alone', () => {
  for (const [group, values] of Object.entries(contractValues)) {
    const spec = drawnEnums[group];
    assert(spec, 'the appearance table draws no ' + group);
    for (const value of values) {
      const channels = Object.entries(spec.channels).filter(
        ([, table]) =>
          Object.hasOwn(table, value) &&
          typeof table[value] === 'string' &&
          table[value].length,
      );
      assert(
        channels.length,
        group + ' ' + value + ' has a tone and no other channel',
      );
      for (const [name, table] of channels)
        assert(
          !/^#[0-9a-f]{3,8}$/i.test(table[value]),
          group + ' ' + value + ' spends a colour on channel ' + name,
        );
    }
    // And one of those channels has to separate every value of the enum, or two
    // values would read alike everywhere colour is missing.
    const separating = Object.entries(spec.channels).filter(([, table]) => {
      const drawn = values.map((value) => table[value]);
      return new Set(drawn).size === drawn.length;
    });
    assert(
      separating.length,
      'no colourless channel tells the values of ' + group + ' apart',
    );
  }
});

// A token is what a legend, a card badge and a panel all print, so it stays
// short, colour-free and unique inside its enum.
test('every drawn value carries a short colourless token', () => {
  for (const [group, table] of Object.entries({
    kind: nodeTags,
    zone: zoneTags,
    relation: relationTags,
  })) {
    assert.deepEqual(
      Object.keys(table).sort(),
      contractValues[group].slice().sort(),
    );
    for (const value of contractValues[group]) {
      assert.match(table[value], /^[A-Z]{2,5}$/, group + ' ' + value);
    }
    assert.equal(
      new Set(Object.values(table)).size,
      contractValues[group].length,
      'two values of ' + group + ' share a token',
    );
  }
  assert.equal(
    nodeAppearance({ kind: 'store', zone: 'pure' }).tag,
    nodeTags.store,
  );
  assert.equal(relationAppearance({ kind: 'state' }).tag, relationTags.state);
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

// A tone is drawn as a line - a card's border, its top edge, a relation - and a
// line is non-text content, so WCAG 2.2 asks it for 3:1 against what it sits on.
// The card sits on the reader's scheme, so both sides of `light-dark()` count,
// and the card tints its own background with the tone, which is the background
// measured here rather than the bare panel.
const channel = (c) =>
  c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const parse = (hex) =>
  [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = parse(hex).map((v) => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};
// The stylesheet's `color-mix(in srgb, var(--accent) 6%, var(--panel))`.
const tinted = (tone, panel) => {
  const [tr, tg, tb] = parse(tone);
  const [pr, pg, pb] = parse(panel);
  const mix = (a, b) => Math.round(a * 0.06 + b * 0.94);
  return (
    '#' +
    [mix(tr, pr), mix(tg, pg), mix(tb, pb)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
  );
};
// Perceptual distance in CIE L*a*b*: two tones of one sequence that sit closer
// than this read as the same tone to a reader who is not comparing them side by
// side. Kept as the plain 1976 distance - the threshold is coarse on purpose.
const lab = (hex) => {
  const [r, g, b] = parse(hex).map((v) => channel(v / 255));
  const white = [0.95047, 1, 1.08883];
  const xyz = [
    0.4124 * r + 0.3576 * g + 0.1805 * b,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    0.0193 * r + 0.1192 * g + 0.9505 * b,
  ].map((v, at) => v / white[at]);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const distance = (a, b) => Math.hypot(...lab(a).map((v, at) => v - lab(b)[at]));
// Both sides of the scheme the stylesheet ships.
const panels = { light: '#fffefb', dark: '#1d221b' };
const sequences = {
  zone: Object.entries(zoneTones),
  relation: Object.entries(relationTones),
  container: rootTones.map((tone, at) => [String(at), tone]),
};

test('every tone the table ships reads as a line on either scheme', () => {
  for (const [group, entries] of Object.entries(sequences))
    for (const [name, tone] of entries)
      for (const [scheme, panel] of Object.entries(panels)) {
        const held = contrast(tone, tinted(tone, panel));
        assert(
          held >= 3,
          group +
            ' ' +
            name +
            ' (' +
            tone +
            ') reads at ' +
            held.toFixed(2) +
            ':1 on the ' +
            scheme +
            ' card',
        );
      }
});

// A tone that stands for a contract value has to be identifiable on its own, so
// the values of an enum are held far apart. A container tone stands for no value:
// it is handed out by position, the container's name is on the card beside it,
// and the sequence has to hold seven tones inside the narrow lightness band both
// schemes read - so it is held only to telling neighbours apart.
const floors = { zone: 30, relation: 30, container: 20 };

test('no two tones of one sequence read as the same tone', () => {
  for (const [group, entries] of Object.entries(sequences))
    for (const [a, first] of entries)
      for (const [b, second] of entries) {
        if (a >= b) continue;
        const apart = distance(first, second);
        assert(
          apart >= floors[group],
          group +
            ' ' +
            a +
            ' (' +
            first +
            ') and ' +
            b +
            ' (' +
            second +
            ') are ' +
            apart.toFixed(1) +
            ' apart, under ' +
            floors[group],
        );
      }
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
