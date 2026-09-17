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

const root = new URL('../', import.meta.url);
const readJSON = async (name) =>
  JSON.parse(await fs.readFile(new URL(name, root), 'utf8'));
// The quickstart is only worth publishing if a reader can run it, so the oracle
// is the shipped package: the fence is cut out of the generated page and every
// specifier, name and code in it is resolved against package.json, the built
// entry and the failure catalogue.
const quickstartHeading = '## Quickstart';
// The walk-through runs from its heading to the picture the page shows next, so
// nothing further down the landing page can stand in for a line it is missing.
const section = (readme) => {
  const at = readme.indexOf(quickstartHeading);
  assert(at >= 0, 'the landing page carries no quickstart');
  const ends = ['\n```mermaid', '\n## ']
    .map((mark) => readme.indexOf(mark, at + quickstartHeading.length))
    .filter((end) => end >= 0);
  assert(ends.length, 'the quickstart runs to the end of the page');
  return readme.slice(at, Math.min(...ends));
};
const fence = (text, language) => {
  const found = text.match(
    new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'),
  );
  assert(found, 'the quickstart has no ' + language + ' block');
  return found[1];
};

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

// A page that opens with a command a reader cannot run is worse than no page, so
// the walk-through is held to the package it tells them to install: the real
// name, the real export map, the real built entry and the codes the raising
// module describes. The consumer fixture is the second oracle - it is what
// `npm run test:package` installs from the tarball and drives in a browser, so a
// snippet naming anything it does not exercise is a snippet nothing proves.
test('the landing page opens with a quickstart the shipped package can run', async () => {
  const pkg = await readJSON('package.json');
  const model = await readJSON('project.json');
  const readme = await generateReadme(model);
  const quickstart = section(readme);
  assert(
    readme.indexOf(quickstartHeading) < readme.indexOf('```mermaid'),
    'the quickstart comes after the picture',
  );
  // Install: the one command, naming the package a reader really installs.
  assert.equal(fence(quickstart, 'sh'), 'npm install ' + pkg.name);
  // Mount: every specifier resolves through the published export map, and every
  // name taken from the package is an export of the built entry.
  const snippet = fence(quickstart, 'js');
  const entry = await import(new URL('dist/src/index.js', root));
  const imports = [
    ...snippet.matchAll(/^import (?:\{([^}]*)\} from )?'([^']+)';$/gm),
  ];
  assert(imports.length > 1, 'the snippet imports nothing');
  for (const [, names, specifier] of imports) {
    const subpath = specifier.replace(pkg.name, '.');
    assert(
      Object.hasOwn(pkg.exports, subpath),
      specifier + ' is not a published entry point',
    );
    for (const name of (names || '').split(',').filter((part) => part.trim()))
      assert.equal(
        typeof entry[name.trim()],
        'function',
        name + ' is not an export',
      );
  }
  // Failure: a code the catalogue describes, and where the whole table lives.
  const codes = [...quickstart.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(
    (m) => m[1],
  );
  assert(codes.length, 'the quickstart names no failure code');
  for (const code of codes)
    assert(Object.hasOwn(failureCodes, code), code + ' is described nowhere');
  assert(
    quickstart.includes(failureCatalogue.title),
    'the quickstart does not say where the codes are listed',
  );
  // The packed consumer already runs what the snippet claims.
  const consumer = await fs.readFile(
    new URL('tests/consumer/main.jsx', root),
    'utf8',
  );
  for (const [, names, specifier] of imports) {
    assert(
      consumer.includes("'" + specifier + "'"),
      specifier + ' is not exercised by the packed consumer',
    );
    for (const name of (names || '').split(',').filter((part) => part.trim()))
      assert(
        new RegExp('\\b' + name.trim() + '\\b').test(consumer),
        name + ' is not exercised by the packed consumer',
      );
  }
  for (const [, member] of snippet.matchAll(/\bmap\.(\w+)/g))
    assert(
      new RegExp('\\.' + member + '\\b').test(consumer),
      'map.' + member + ' is not exercised by the packed consumer',
    );
  assert.equal(readme, await generateReadme(await readJSON('project.json')));
});

// The renderer draws any project's landing page, and a project that does not
// ship this package must not tell its readers to install itself.
test('a project that binds neither the package nor the mount entry gets no quickstart', async () => {
  const readme = await generateReadme(ready());
  assert(
    !readme.includes(quickstartHeading),
    'a foreign project was given a quickstart',
  );
});

// A question filed as a fact is the failure this section prevents: the reference
// lists every question-origin source, and says so plainly when there are none.
test('the reference lists the open questions instead of filing them as facts', async () => {
  const copy = JSON.parse(
    await fs.readFile(
      new URL('../assets/archivarius-project-strings.json', import.meta.url),
      'utf8',
    ),
  );
  const bare = clone();
  const empty = await generateDocumentation(bare);
  assert(
    empty.includes('## ' + copy.openQuestions),
    'no open-questions heading',
  );
  assert(empty.includes(copy.noOpenQuestions), 'no empty note');
  const model = clone();
  const context = projectContext(model, ['project', 'owner-intent']);
  const asked = applyProjectChanges(model, context, {
    put: [
      {
        key: 'open-question',
        type: 'source',
        title: 'Does a reader want the map or the list first?',
        statement: 'Unanswered until a reader is watched using it.',
        origin: 'question',
        scope: 'project',
      },
    ],
  });
  const markdown = await generateDocumentation(asked);
  assert(markdown.includes(copy.openQuestionsNote), 'no open note');
  assert(
    markdown.includes(
      '- [Does a reader want the map or the list first?](#record-open-question)',
    ),
    'the question is not listed',
  );
  assert(
    !markdown.includes(copy.noOpenQuestions),
    'still claims none are open',
  );
});
