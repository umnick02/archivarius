import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawnEnums } from '../src/model/appearance.mjs';
import {
  legendGroups,
  legendOrder,
  legendTable,
  legendCopy,
  panelWords,
  valueWords,
} from '../src/model/legend.mjs';
import { renderProjectDocumentation } from '../src/model/project-document.mjs';
import { clone } from './project-fixture.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, root), 'utf8'));
const schema = await readJSON('assets/model.schema.json');
const project = await readJSON('assets/project.json');

// The enums are read off the shipped contract, never listed here: a value the
// schema gains has to reach the legend or these cases fail.
const branch = (type) =>
  schema.$defs.record.oneOf.find((one) => one.properties?.type?.const === type);
const contractValues = {
  kind: branch('component').properties.kind.enum,
  zone: branch('component').properties.zone.enum,
  relation: branch('interaction').properties.kind.enum,
};

// The words come from the shipped copy, so a value nobody has named cannot be
// papered over by the legend inventing English of its own.
const legendFixture = (over = {}) => ({
  title: 'How to read the picture',
  note: 'Every value reads without colour.',
  columns: ['Group', 'Value', 'Tag', 'Drawn as'],
  groups: { kind: 'Kind', zone: 'Layer', relation: 'Interaction' },
  channels: {
    shape: { box: 'Rectangle', cylinder: 'Barrel', stadium: 'Pill' },
    outline: { solid: 'Unbroken border', dashed: 'Broken border' },
    line: { solid: 'Thin arrow', thick: 'Thick arrow', dotted: 'Dotted arrow' },
  },
  words: {
    kind: project.values,
    zone: project.values,
    relation: project.values,
  },
  ...over,
});

test('the legend covers every contract value the schema allows', () => {
  assert.deepEqual(
    legendOrder.slice().sort(),
    Object.keys(contractValues).sort(),
  );
  const groups = legendGroups(legendFixture());
  for (const group of legendOrder) {
    const found = groups.find((entry) => entry.group === group);
    assert(found, 'the legend has no group for ' + group);
    assert.deepEqual(
      found.entries.map((entry) => entry.value).sort(),
      contractValues[group].slice().sort(),
      'the legend for ' + group + ' has drifted from the contract',
    );
  }
});

test('the legend gives every value a word and a channel that is not a colour', () => {
  for (const group of legendGroups(legendFixture()))
    for (const entry of group.entries) {
      assert.equal(typeof entry.word, 'string');
      assert(entry.word.length, entry.value + ' has no word');
      const colourless = Object.entries(entry.channels).filter(
        ([, value]) => typeof value === 'string' && value.length,
      );
      assert(
        colourless.length,
        entry.value + ' is drawn with a tone and nothing else',
      );
      for (const [, channel] of colourless)
        assert(
          !/^#[0-9a-f]{3,8}$/i.test(channel),
          entry.value + ' spends a colour where a channel is expected',
        );
    }
});

// A legend row that no reader can tell from the row above it is decoration. One
// channel per enum has to separate every value in it.
test('one colourless channel tells every value of an enum apart', () => {
  for (const [group, spec] of Object.entries(drawnEnums)) {
    const separating = Object.entries(spec.channels).filter(([, table]) => {
      const drawn = contractValues[group].map((value) => table[value]);
      return new Set(drawn).size === drawn.length;
    });
    assert(
      separating.length,
      'no colourless channel separates the values of ' + group,
    );
  }
});

test('a value the copy has no word for stops the legend instead of drawing a colour', () => {
  const words = { ...project.values };
  delete words.store;
  assert.throws(
    () =>
      legendGroups(
        legendFixture({ words: { ...legendFixture().words, kind: words } }),
      ),
    /store/,
  );
  assert.throws(() => valueWords(legendFixture(), 'kind', 'widget'), /widget/);
  assert.throws(
    () => valueWords(legendFixture(), 'nowhere', 'store'),
    /nowhere/,
  );
});

test('the panel words name the value and the token it is drawn with', () => {
  for (const group of legendGroups(legendFixture()))
    for (const entry of group.entries) {
      const words = valueWords(legendFixture(), group.group, entry.value);
      assert(words.includes(entry.word), 'the panel drops the word');
      assert(
        words.includes(entry.channels.tag),
        'the panel drops the colourless token',
      );
    }
});

test('the legend table states every value in a row of its own', () => {
  const copy = legendFixture();
  const lines = legendTable(copy);
  const text = lines.join('\n');
  assert(text.includes(copy.title), 'the table has no title');
  for (const group of legendOrder)
    for (const value of contractValues[group]) {
      const word = copy.words[group][value];
      assert(
        lines.some((line) => line.startsWith('|') && line.includes(word)),
        'no row for ' + group + ' ' + value,
      );
    }
  // A table is a table: the header, its rule and one row per value.
  const rows = lines.filter((line) => line.startsWith('|'));
  const values = legendOrder.reduce(
    (total, group) => total + contractValues[group].length,
    0,
  );
  assert.equal(rows.length, values + 2);
});

test('the generated reference carries the legend read from the appearance table', () => {
  const copy = { ...project, legend: legendFixture() };
  const markdown = renderProjectDocumentation(clone(), copy);
  assert(markdown.includes(copy.legend.title), 'the reference has no legend');
  // The legend follows the picture it explains, not the record list.
  const fence = markdown.indexOf('```mermaid');
  assert(fence >= 0, 'the reference has no diagram');
  const at = markdown.indexOf(copy.legend.title);
  assert(at > fence, 'the legend is printed before the diagram');
  for (const group of legendOrder)
    for (const value of contractValues[group])
      assert(
        markdown.includes(
          copy.words?.[group]?.[value] ?? project.values[value],
        ),
        'the reference legend omits ' + value,
      );
  // The picture stays the picture: no legend statement leaks into the diagram.
  const diagram = markdown.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  assert(
    !diagram.includes(copy.legend.title),
    'the legend leaked into the diagram',
  );
});

test('the legend adds no active content to the generated page', () => {
  const hostile = legendFixture({
    title: 'A `b` <img onerror="x"> | # heading',
    note: '## not a heading\n<script>alert(1)</script>',
  });
  const markdown = renderProjectDocumentation(clone(), {
    ...project,
    legend: hostile,
  });
  const at = markdown.indexOf('A \\`b\\`');
  assert(at >= 0, 'the hostile title was not neutralized');
  const printed = markdown.slice(at, markdown.indexOf('\n', at));
  for (const raw of ['<img', '<script', '`b`'])
    assert(!printed.includes(raw), 'the legend still carries ' + raw);
  assert(!/^## not a heading$/m.test(markdown), 'the note became a heading');
  assert(!markdown.includes('<script>'), 'the page gained a script');
});

test('the reference carries the legend its copy words, and none without it', () => {
  const markdown = renderProjectDocumentation(clone(), project);
  assert(markdown.includes(project.legend.title), 'the legend is missing');
  const { legend, ...wordless } = project;
  assert(legend, 'the copy carries no legend to drop');
  assert(
    !renderProjectDocumentation(clone(), wordless).includes(legend.title),
    'the legend appeared without the copy that words it',
  );
});

// The map's own copy is the oracle here: a value the contract gains has no word
// under `nodeKinds`, `zones` or `kinds` until somebody writes one, and a panel
// that cannot name a value would be left with a colour.
test('the map copy names every contract value a panel can be shown', async () => {
  const strings = await readJSON('assets/strings.json');
  const words = { kind: 'nodeKinds', zone: 'zones', relation: 'kinds' };
  for (const group of legendOrder)
    for (const value of contractValues[group]) {
      const word = strings[words[group]]?.[value];
      assert.equal(
        typeof word,
        'string',
        'assets/strings.json ' + words[group] + '.' + value + ' is missing',
      );
      assert(word.length, words[group] + '.' + value + ' is empty');
    }
});

test('a panel names the value in words, never a tone alone', async () => {
  const strings = await readJSON('assets/strings.json');
  const words = {
    kind: strings.nodeKinds,
    zone: strings.zones,
    relation: strings.kinds,
  };
  const legend = legendCopy(strings.legend, words);
  assert(legend, 'the shipped copy carries no legend');
  assert.deepEqual(legend.words.kind, strings.nodeKinds);
  for (const group of legendOrder)
    for (const value of contractValues[group]) {
      const shown = panelWords(legend, group, value);
      assert(
        shown.includes(words[group][value]),
        'the panel drops the word for ' + value,
      );
      assert(!/#[0-9a-f]{6}/i.test(shown), 'the panel prints a tone');
    }
  // A value or a group the legend does not hold raises instead of printing a
  // blank, and a surface that hands over no legend at all raises too.
  assert.throws(() => panelWords(legend, 'kind', 'widget'), /widget/);
  assert.throws(() => panelWords(legend, 'nowhere', 'store'), /nowhere/);
  assert.throws(() => panelWords(null, 'kind', 'store'), /kind/);
});
