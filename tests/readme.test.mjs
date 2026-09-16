import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatedNotice } from '../src/model/documents.mjs';
import { projectArchitecture } from '../src/model/project.mjs';
import prose from '../src/generated/prose.mjs';
import { renderReadme } from '../docs/scripts/readme.mjs';

const model = JSON.parse(
  await fs.readFile(new URL('../docs/project.json', import.meta.url), 'utf8'),
);
const record = (type) => model.records.find((r) => r.type === type);
const records = (type) => model.records.filter((r) => r.type === type);

test('the readme opens with the scope as the only heading', () => {
  const readme = renderReadme(model);
  assert.equal(readme.split('\n')[0], '# ' + record('scope').title);
  assert.equal(readme.match(/^#+ /gm).length, 1);
});

test('the readme states the purpose and the sources from the model', () => {
  const readme = renderReadme(model);
  assert(readme.includes(record('scope').purpose), 'missing the purpose');
  for (const source of records('source'))
    assert(readme.includes(source.statement), 'missing ' + source.key);
});

test('the readme carries the diagram the map draws, not a separate picture', () => {
  const readme = renderReadme(model);
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
  const readme = renderReadme(model);
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
          assert(source.includes(cell), 'text absent from the model: ' + cell);
      continue;
    }
    assert(source.includes(line.trim()), 'text absent from the model: ' + line);
  }
});

test('the readme drops the inspector furniture and stays one screen', () => {
  const readme = renderReadme(model);
  for (const furniture of ['<a id=', 'Snapshot:', '**', 'Reload after'])
    assert(!readme.includes(furniture), 'leaked ' + furniture);
  assert(
    readme.split('\n').length <= 60,
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
  const readme = renderReadme(model);
  const architecture = projectArchitecture(model);
  const leaves = [];
  const walk = (node) => {
    if (node.children?.length) for (const child of node.children) walk(child);
    else leaves.push(node);
  };
  for (const node of architecture.nodes) walk(node);
  for (const node of leaves) {
    const record = model.records.find((r) => r.key === node.key);
    for (const field of prose[record.type])
      if (record[field.name])
        assert(
          readme.includes(record[field.name]),
          'missing ' + field.name + ' of ' + node.key,
        );
  }
  for (const relation of architecture.relations)
    for (const field of prose.interface)
      if (relation[field.name])
        assert(
          readme.includes(relation[field.name]),
          'missing ' + field.name + ' of ' + relation.key,
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

test('rendering the same model twice gives the same readme', () => {
  assert.equal(renderReadme(model), renderReadme(structuredClone(model)));
});
