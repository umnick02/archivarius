import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest } from '../src/model/digest.mjs';
import { projectArchitecture } from '../src/model/project-architecture.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { generateDocumentation } from '../src/node.mjs';
import { generatedNotice } from '../src/model/documents.mjs';
import { clone, get } from './project-fixture.mjs';

test('documentation and history retain records and links without a separate prose source', async () => {
  const original = clone(),
    context = projectContext(original, ['row-limit']);
  const updated = structuredClone(get(original, 'row-limit'));
  updated.parameters.maxRows = 100;
  const model = applyProjectChanges(original, context, { put: [updated] });
  const markdown = await generateDocumentation(model);
  for (const record of model.records)
    assert(markdown.includes('id="record-' + record.key + '"'));
  assert(markdown.includes(digest(model)));
  assert.equal(markdown, await generateDocumentation(structuredClone(model)));
  const broken = structuredClone(model);
  broken.history[0].record.parameters.maxRows = 999;
  assert.equal(validateProject(broken).valid, false);
});

test('documentation renders the architecture as a diagram generated from components and interactions', async () => {
  const model = clone();
  const markdown = await generateDocumentation(model);
  const fence = markdown.match(/```mermaid\n([\s\S]*?)\n```/);
  assert(fence, 'expected a generated mermaid block');
  const diagram = fence[1];
  assert.match(diagram, /^flowchart/);
  const components = model.records.filter((r) => r.type === 'component');
  // Every component appears as a node and every subsystem groups its children.
  for (const component of components) {
    assert(
      diagram.includes(component.key),
      'missing component ' + component.key,
    );
    assert(
      diagram.includes(component.title),
      'missing title ' + component.title,
    );
    if (components.some((other) => other.parent === component.key))
      assert(
        new RegExp('subgraph \\S*' + component.key).test(diagram),
        'missing subgraph ' + component.key,
      );
  }
  // Every interaction appears as an edge carrying the label the map shows,
  // which the projection derives even when the record states none.
  for (const relation of projectArchitecture(model).relations)
    assert(
      diagram.includes(relation.label),
      'missing interaction ' + relation.key,
    );
  assert.equal(markdown, await generateDocumentation(structuredClone(model)));
});

test('diagram identifiers never collide with Mermaid keywords', async () => {
  // The repository's own model is the real fixture: it owns a component keyed
  // "graph", which Mermaid reads as the start of a diagram.
  const reserved = [
    'graph',
    'subgraph',
    'end',
    'flowchart',
    'class',
    'classDef',
    'style',
    'linkStyle',
    'click',
    'direction',
    'default',
  ];
  const model = JSON.parse(
    await fs.readFile(new URL('../project.json', import.meta.url), 'utf8'),
  );
  assert(
    model.records.some(
      (r) => r.type === 'component' && reserved.includes(r.key),
    ),
    'fixture needs a component keyed with a Mermaid keyword',
  );
  const markdown = await generateDocumentation(model);
  const diagram = markdown.match(/```mermaid\n([\s\S]*?)\n```/)[1];
  for (const word of reserved)
    assert(
      !new RegExp('(?:^|[\\s|])' + word + '(?:\\[|\\s*--)', 'm').test(diagram),
      'reserved identifier: ' + word,
    );
});

test('documentation omits fields without a value instead of printing them', async () => {
  const model = clone();
  // The suite creates the empty field itself rather than depending on the
  // fixture still happening to carry one, so populating a basis cannot retire
  // this oracle.
  for (const record of model.records)
    if ('basis' in record) record.basis = null;
  assert(
    model.records.some((r) => r.basis === null),
    'the model must have a record that can hold a basis',
  );
  const markdown = await generateDocumentation(model);
  assert(!/^null$/m.test(markdown), 'a null field leaked into the output');
});

test('documentation ends with the generated notice so the file is not hand-edited', async () => {
  const markdown = await generateDocumentation(clone());
  assert(markdown.trimEnd().endsWith(generatedNotice), markdown.slice(-120));
});

test('documentation escapes only what Markdown needs, leaving prose readable', async () => {
  const markdown = await generateDocumentation(clone());
  assert(!markdown.includes('\\.'), 'sentence periods must not be escaped');
  assert(!markdown.includes('\\-'), 'hyphens inside words must not be escaped');
});
