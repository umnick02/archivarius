import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedNotice } from '../src/model/documents.mjs';
import { projectArchitecture } from '../src/model/project-architecture.mjs';
import prose from '../src/generated/prose.mjs';
import { recordSummary } from '../src/model/project-view.mjs';
import { renderReadme, readCopy } from '../docs/scripts/readme.mjs';

const model = JSON.parse(
  await fs.readFile(new URL('../docs/project.json', import.meta.url), 'utf8'),
);
const copy = await readCopy();
// A heading or a note is wording the map already shows, never a word of the
// generator's; a template counts once its placeholders are filled.
const strings = (value) =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(strings)
      : [];
const labels = new Set(strings(copy));
const fromCopy = (line) =>
  [...labels].some(
    (label) =>
      label === line ||
      (label.includes('{') &&
        new RegExp(
          '^' +
            label
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/\\\{\w+\\\}/g, '.+') +
            '$',
        ).test(line)),
  );
const record = (type) => model.records.find((r) => r.type === type);
const records = (type) => model.records.filter((r) => r.type === type);

test('the readme opens with the scope as the only heading', () => {
  const readme = renderReadme(model, copy);
  assert.equal(readme.split('\n')[0], '# ' + record('scope').title);
  assert.equal(readme.match(/^#+ /gm).length, 1);
});

test('the readme states the purpose and the sources from the model', () => {
  const readme = renderReadme(model, copy);
  assert(readme.includes(record('scope').purpose), 'missing the purpose');
  for (const source of records('source'))
    assert(readme.includes(source.statement), 'missing ' + source.key);
});

test('the readme carries the diagram the map draws, not a separate picture', () => {
  const readme = renderReadme(model, copy);
  const fence = readme.match(/```mermaid\n([\s\S]*?)\n```/);
  assert(fence, 'missing the diagram');
  const diagram = fence[1];
  const architecture = projectArchitecture(model);
  const flat = [];
  const walk = (node) => {
    flat.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of architecture.nodes) walk(node);
  // Every node and every relation the UI renders is present in the diagram.
  for (const node of flat) {
    assert(diagram.includes(node.title), 'missing node ' + node.key);
    if (node.children?.length)
      assert(
        new RegExp('subgraph \\S*' + node.key).test(diagram),
        'missing group ' + node.key,
      );
  }
  for (const relation of architecture.relations)
    assert(diagram.includes(relation.label), 'missing edge ' + relation.key);
});

test('the readme carries no text of its own', () => {
  const readme = renderReadme(model, copy);
  const source = model.records
    .map((r) => Object.values(r).join('\n'))
    .join('\n');
  // Every prose line must come from the model, so the generator cannot smuggle
  // in a sentence that no record states.
  const diagram = readme.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  for (const line of readme.split('\n')) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('<!--'))
      continue;
    if (line.startsWith('```')) continue;
    if (diagram.includes(line)) continue;
    if (line.startsWith('|')) {
      // A row is structure; every cell it carries must still come from a record.
      const cells = line
        .split('|')
        .flatMap((c) => c.split('<br>'))
        .map((c) => c.trim().replaceAll('\\|', '|'));
      for (const cell of cells)
        if (cell && !/^-+$/.test(cell))
          assert(
            source.includes(cell) || fromCopy(cell),
            'text absent from the model: ' + cell,
          );
      continue;
    }
    assert(
      source.includes(line.trim()) || fromCopy(line.trim()),
      'text absent from the model: ' + line,
    );
  }
});

test('the readme drops the inspector furniture and never grows into a report', () => {
  const readme = renderReadme(model, copy);
  for (const furniture of ['<a id=', 'Snapshot:', '**', 'Reload after'])
    assert(!readme.includes(furniture), 'leaked ' + furniture);
  // A row per record at most: the readme must never turn back into a section
  // per record with its full field set.
  assert(
    readme.split('\n').length <= 3 * model.records.length,
    'too long: ' + readme.split('\n').length,
  );
  assert(readme.trimEnd().endsWith(generatedNotice), 'missing the notice');
});

test('the prose table is derived from the schema, not written by hand', async () => {
  const schema = JSON.parse(
    await fs.readFile(
      new URL('../assets/model.schema.json', import.meta.url),
      'utf8',
    ),
  );
  for (const variant of schema.$defs.record.oneOf) {
    const type = variant.properties.type.const;
    const expected = Object.entries(variant.properties)
      .filter(([, field]) => /#\/\$defs\/texts?$/.test(field.$ref || ''))
      .map(([name]) => name);
    assert.deepEqual(
      prose[type].map((field) => field.name),
      expected,
      'prose fields drifted for ' + type,
    );
  }
});

test('the readme states what every part does and what crosses every edge', () => {
  const readme = renderReadme(model, copy);
  const architecture = projectArchitecture(model);
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of architecture.nodes) walk(node);
  // The line the map shows when a record is collapsed is the floor: no part and
  // no edge may reach the readme without saying what it is.
  for (const node of nodes) {
    const record = model.records.find((r) => r.key === node.key);
    const summary = recordSummary(record);
    assert(summary, 'nothing summarizes ' + node.key);
    assert(readme.includes(summary), 'missing the summary of ' + node.key);
  }
  for (const relation of architecture.relations)
    assert(
      readme.includes(recordSummary({ ...relation, type: 'interface' })),
      'missing the summary of ' + relation.key,
    );
});

test('the generator never names a field of the schema', async () => {
  const source = await fs.readFile(
    new URL('../docs/scripts/readme.mjs', import.meta.url),
    'utf8',
  );
  const names = new Set(
    Object.values(prose).flatMap((fields) => fields.map((f) => f.name)),
  );
  for (const name of names)
    assert(
      !new RegExp('[\'"]' + name + '[\'"]').test(source),
      'the generator hardcodes the field ' + name,
    );
});

test('every table states its columns with the labels the map uses', () => {
  const readme = renderReadme(model, copy);
  const headers = readme
    .split('\n')
    .filter((line, index, lines) => /^\| -+ \|/.test(lines[index + 1] || ''));
  assert(headers.length >= 2, 'expected a heading row per table');
  for (const header of headers)
    for (const heading of header.split('|').map((c) => c.trim()))
      if (heading)
        assert(fromCopy(heading), 'heading absent from the copy: ' + heading);
});

test('every prose field the schema declares has a label in the copy', () => {
  for (const [type, fields] of Object.entries(prose)) {
    if (copy.types[type] === undefined) continue;
    for (const field of fields)
      assert(
        copy.fields[field.name],
        'no label for ' + type + '.' + field.name,
      );
  }
});

test('rendering the same model twice gives the same readme', () => {
  assert.equal(
    renderReadme(model, copy),
    renderReadme(structuredClone(model), copy),
  );
});
