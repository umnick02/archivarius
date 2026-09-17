import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedNotice } from '../src/model/documents.mjs';
import { projectArchitecture } from '../src/model/project-architecture.mjs';
import prose from '../src/generated/prose.mjs';
import { recordSummary } from '../src/model/project-view.mjs';
import { renderProjectReadme } from '../src/model/project-readme.mjs';
import { generateReadme } from '../src/node.mjs';

const readCopy = async () =>
  JSON.parse(
    await fs.readFile(
      new URL('../assets/archivarius-project-strings.json', import.meta.url),
      'utf8',
    ),
  );
const renderReadme = renderProjectReadme;

const model = JSON.parse(
  await fs.readFile(new URL('../project.json', import.meta.url), 'utf8'),
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

test('the readme opens with the scope and writes no heading of its own', () => {
  const readme = renderReadme(model, copy);
  assert.equal(readme.split('\n')[0], '# ' + record('scope').title);
  // One top-level heading, and any section under it is wording the copy owns:
  // the generator may not name a section the project never worded.
  const headings = readme.match(/^#+ .*/gm);
  assert.equal(headings.filter((h) => h.startsWith('# ')).length, 1);
  for (const heading of headings.slice(1)) {
    assert(heading.startsWith('## '), 'buried heading: ' + heading);
    assert(
      fromCopy(heading.slice(3)),
      'heading absent from the copy: ' + heading,
    );
  }
});

test('the readme states the purpose from the model', () => {
  const readme = renderReadme(model, copy);
  assert(readme.includes(record('scope').purpose), 'missing the purpose');
});

// The landing page is the walk-through, not the report: the grounds, the rules,
// the decisions, the scenarios and the interface list belong to the reference,
// which prints them in full. A landing page that reprints them buries the one
// command a reader came for under a wall no reader reads first.
test('the readme leaves the reference-only sections to the reference', () => {
  const readme = renderReadme(model, copy);
  for (const type of ['source', 'requirement', 'decision', 'scenario']) {
    if (!copy.types[type]) continue;
    assert(
      !readme.includes('## ' + copy.types[type]),
      'the landing page reprints the ' + type + ' section',
    );
  }
  // The sources are the heaviest of them: not one statement may leak through.
  for (const source of records('source'))
    assert(
      !readme.includes(source.statement),
      'a source statement leaked onto the landing page: ' + source.key,
    );
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
  // in a sentence that no record states. A fenced block is quoted data, checked
  // below against the records it claims to show.
  let fenced = false;
  for (const line of readme.split('\n')) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (!line.trim() || line.startsWith('#') || line.startsWith('<!--'))
      continue;
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
      new URL('../assets/archivarius-model.schema.json', import.meta.url),
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

test('the readme states what every part does', () => {
  const readme = renderReadme(model, copy);
  const architecture = projectArchitecture(model);
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of architecture.nodes) walk(node);
  // The line the map shows when a record is collapsed is the floor: no part may
  // reach the readme without saying what it is. The edges are drawn in the
  // diagram and named there; the reference carries their full contract.
  for (const node of nodes) {
    const record = model.records.find((r) => r.key === node.key);
    const summary = recordSummary(record);
    assert(summary, 'nothing summarizes ' + node.key);
    assert(readme.includes(summary), 'missing the summary of ' + node.key);
  }
});

test('the readme states only the parts whose realization the model binds', () => {
  const record = model.records.find((r) => r.key === 'inspector');
  assert(renderReadme(model, copy).includes(recordSummary(record)));
  const unbound = structuredClone(model);
  delete unbound.bindings.inspector;
  const readme = renderReadme(unbound, copy);
  assert(
    !readme.includes(recordSummary(record)),
    'an unbound part still states what it does',
  );
  assert(!readme.includes('c-inspector'), 'an unbound part is still drawn');
});

// Evidence goes stale on every source edit by design, so a page that reported it
// would need regenerating after every commit and would drift in CI instead.
test('the readme reads the model, not the state of its evidence', async () => {
  const source = await fs.readFile(
    new URL('../src/model/project-readme.mjs', import.meta.url),
    'utf8',
  );
  assert(
    !/analysis|analyze|completion|confirmed/i.test(source),
    'the generator reads confirmation state',
  );
});

test('the generator never names a field of the schema', async () => {
  const source = await fs.readFile(
    new URL('../src/model/project-readme.mjs', import.meta.url),
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
  assert(headers.length >= 1, 'expected a heading row per table');
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

test('the public entry renders the readme with the shipped copy', async () => {
  assert.equal(await generateReadme(model), renderReadme(model, copy));
});

test('rendering the same model twice gives the same readme', () => {
  assert.equal(
    renderReadme(model, copy),
    renderReadme(structuredClone(model), copy),
  );
});

// A record is data, not prose: dumping one on the landing page shows a reader a
// field set instead of the system, and the reference view already prints them.
test('the readme quotes no raw record', () => {
  const readme = renderReadme(model, copy);
  const lines = readme.split('\n');
  let open = null;
  for (const line of lines) {
    if (!line.startsWith('```')) {
      // Inside any fence that is not the diagram, every line is copy the
      // project worded: a snippet may show an API, never dump a record.
      if (open && open !== '```mermaid')
        assert(
          !line.trim() || fromCopy(line),
          'a fenced line the copy does not word: ' + line,
        );
      continue;
    }
    open = open ? null : line;
  }
  assert.equal(open, null, 'an unclosed fence is on the landing page');
});
