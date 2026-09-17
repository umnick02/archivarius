import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { digest } from '../src/model/digest.mjs';
import {
  relationLines,
  relationTones,
  zoneTones,
} from '../src/model/appearance.mjs';
import { projectArchitecture } from '../src/model/project-architecture.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { validateProject } from '../src/model/project-contract.mjs';
import { generateDocumentation, generateReadme } from '../src/node.mjs';
import { escape, generatedNotice } from '../src/model/documents.mjs';
import { failureCatalogue, failureCodes } from '../src/model/errors.mjs';
import { clone, get, ready } from './project-fixture.mjs';

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

test('the diagram distinguishes a node by its zone and its kind, not by one flat rectangle', async () => {
  const model = clone();
  const diagram = (await generateDocumentation(model)).match(
    /```mermaid\n([\s\S]*?)\n```/,
  )[1];
  const components = model.records.filter((r) => r.type === 'component');
  const grouping = (record) =>
    components.some((other) => other.parent === record.key);
  const zones = [
    ...new Set(components.filter((r) => !grouping(r)).map((r) => r.zone)),
  ];
  assert(zones.length > 1, 'the fixture needs more than one zone');
  // A class per zone the drawn nodes actually use, carrying that zone's tone as
  // a stroke. The fill stays with the reader's theme: one markdown source is
  // rendered on a light and a dark page, so a literal fill would hide a label.
  for (const zone of zones) {
    const rule = diagram.match(
      new RegExp('^\\s*classDef ' + zone + ' .*$', 'm'),
    );
    assert(rule, 'missing a class for zone ' + zone);
    assert(
      rule[0].includes(zoneTones[zone]),
      'zone ' + zone + ' does not carry its shared tone',
    );
    assert(
      !/fill:|color:/.test(rule[0]),
      'zone ' + zone + ' paints over the reader’s theme',
    );
  }
  // Every drawn component states its zone: a leaf through the class shorthand,
  // a grouping subsystem through a style line on its subgraph.
  for (const component of components) {
    const groups = grouping(component);
    const pattern = groups
      ? new RegExp('^\\s*style \\S*' + component.key + ' .*$', 'm')
      : new RegExp(
          '^\\s*\\S*' + component.key + '.*:::' + component.zone + '$',
          'm',
        );
    const line = diagram.match(pattern);
    assert(line, 'component ' + component.key + ' is drawn without its zone');
    if (groups) {
      assert(
        line[0].includes(zoneTones[component.zone]),
        'subgraph ' + component.key + ' does not carry its zone tone',
      );
      assert(
        !/fill:|color:/.test(line[0]),
        'subgraph ' + component.key + ' paints over the reader’s theme',
      );
    }
  }
  // A relation kind reads twice over, as a line and as a tone, so the picture
  // says the same thing the map says without a legend beside it.
  const relations = projectArchitecture(model).relations;
  const kinds = new Set(relations.map((r) => r.kind));
  assert(kinds.size > 1, 'the fixture needs more than one relation kind');
  const opener = { solid: '-->', thick: '==>', dotted: '-.->' };
  relations.forEach((relation, index) => {
    const line = opener[relationLines[relation.kind]];
    assert(
      diagram.includes(
        ' ' + line + '|"' + relation.label.replaceAll('"', '#quot;') + '"|',
      ),
      'relation ' + relation.key + ' is not drawn as a ' + relation.kind,
    );
    const styled = [...diagram.matchAll(/^\s*linkStyle ([\d,]+) (.+)$/gm)].find(
      (m) => m[1].split(',').includes(String(index)),
    );
    assert(styled, 'relation ' + relation.key + ' carries no tone');
    assert(
      styled[2].includes(relationTones[relation.kind]),
      'relation ' + relation.key + ' invents a tone',
    );
  });
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

test('a hostile title stays one inert Mermaid label', async () => {
  const model = clone();
  const component = model.records.find((r) => r.type === 'component');
  component.title = 'A `b` <img onerror="x"> #1\nsecond --> line; end';
  const diagram = (await generateDocumentation(model)).match(
    /```mermaid\n([\s\S]*?)\n```/,
  )[1];
  const statement = diagram
    .split('\n')
    .filter((line) => line.includes('#quot;') || line.includes('#60;'));
  assert.equal(statement.length, 1, 'the title spread across statements');
  const [, text] = statement[0].match(/"([^"]*)"/);
  for (const raw of ['`', '<', '>'])
    assert(!text.includes(raw), 'the label still carries ' + raw);
  assert(!/\n/.test(text), 'the label kept a newline');
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

test('the CLI writes the readme and reports drift without touching the file', async () => {
  const root = new URL('../', import.meta.url);
  const run = (args) =>
    spawnSync(process.execPath, ['src/cli.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  await fs.mkdir(new URL('.runtime/', root), { recursive: true });
  const directory = await fs.mkdtemp(new URL('.runtime/readme-', root));
  const input = directory + '/project.json',
    output = directory + '/README.md';
  try {
    await fs.writeFile(input, JSON.stringify(clone()));
    assert.equal(run(['readme', input, '--output', output]).status, 0);
    assert.equal(
      await fs.readFile(output, 'utf8'),
      await generateReadme(clone()),
    );
    assert.equal(
      run(['readme', input, '--output', output, '--check']).status,
      0,
    );
    await fs.appendFile(output, '\nmanual change');
    assert.equal(
      run(['readme', input, '--output', output, '--check']).status,
      1,
    );
    assert((await fs.readFile(output, 'utf8')).endsWith('manual change'));
    assert.equal(run(['readme', input, '--output', input]).status, 1);
    assert.equal(run(['readme', input]).status, 2);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// An external part is not this repository's to carry, so a missing file cannot
// be read as a missing realization: dropping it would take the edges that cross
// the system boundary with it.
test('the readme keeps an external part and its edges without a file behind them', async () => {
  const model = ready();
  const external = get(model, 'screen');
  // A store outside the boundary declares itself by its zone, not its kind.
  external.kind = 'store';
  external.zone = 'external';
  delete model.bindings[external.key];
  const readme = await generateReadme(model);
  assert(readme.includes(external.summary), 'the external part was dropped');
  assert(
    readme.includes('c-' + external.key),
    'the external part is not drawn',
  );
  for (const edge of model.records.filter(
    (r) => r.type === 'interaction' && [r.from, r.to].includes(external.key),
  ))
    assert(readme.includes(edge.title), 'an edge to the boundary was dropped');
});

// The catalogue is only worth publishing if it stays true, so the oracle is the
// source itself: every code literal handed to a failure constructor anywhere in
// `src/`, read back out of the files that raise it.
async function raisedFailureCodes() {
  const root = new URL('../src/', import.meta.url);
  const raised = new Map();
  for (const name of await fs.readdir(root, { recursive: true })) {
    if (!/\.(mjs|jsx)$/.test(name) || name.startsWith('generated')) continue;
    const source = await fs.readFile(new URL(name, root), 'utf8');
    for (const [, code] of source.matchAll(
      /new (?:ArchitectureError|Error|DOMException)\(\s*'([A-Z][A-Z0-9_]*[A-Z0-9]):?'/g,
    )) {
      if (!raised.has(code)) raised.set(code, []);
      raised.get(code).push('src/' + name);
    }
  }
  return raised;
}

test('every failure code raised in the source is described once by the module that owns them', async () => {
  const raised = await raisedFailureCodes();
  assert(raised.size > 20, 'the scan found no failure constructors');
  const described = new Set(Object.keys(failureCodes));
  for (const [code, files] of raised)
    assert(
      described.has(code),
      code + ' is raised in ' + files.join(', ') + ' and described nowhere',
    );
  for (const code of described)
    assert(raised.has(code), code + ' is described but nothing raises it');
  for (const [code, entry] of Object.entries(failureCodes)) {
    assert.deepEqual(Object.keys(entry), ['meaning', 'remedy'], code);
    for (const [field, text] of Object.entries(entry)) {
      const where = code + '.' + field;
      assert.equal(typeof text, 'string', where);
      assert.equal(text.trim(), text, where + ' is padded');
      assert(text.length > 15, where + ' says nothing');
      assert(text.endsWith('.'), where + ' is not a sentence');
      assert.equal(
        text.split('.').filter((part) => part.trim()).length,
        1,
        where + ' is more than one sentence',
      );
    }
  }
});

test('documentation publishes the failure catalogue held by the module that raises the codes', async () => {
  const markdown = await generateDocumentation(clone());
  assert(
    markdown.includes('## ' + failureCatalogue.title),
    'the reference has no failure section',
  );
  assert(
    markdown.includes('| ' + failureCatalogue.columns.join(' | ') + ' |'),
    'the failure table has no header',
  );
  for (const [code, { meaning, remedy }] of Object.entries(failureCodes))
    assert(
      markdown.includes(
        '| `' + code + '` | ' + escape(meaning) + ' | ' + escape(remedy) + ' |',
      ),
      'the reference does not describe ' + code,
    );
  assert.equal(markdown, await generateDocumentation(clone()));
});
