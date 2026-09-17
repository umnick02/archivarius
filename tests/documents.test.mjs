import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateDocumentation, readArchitectureFile } from '../src/node.mjs';
import { renderDocumentation } from '../src/model/document.mjs';
import { ArchitectureGraph } from '../src/model/graph.mjs';
import { architectureDiagram } from '../src/model/project-document.mjs';
import { files, staleParts } from '../docs/scripts/bind.mjs';
import { bindingParts } from '../src/model/binding.mjs';
import documentRecords from './fixtures/documents.json' with { type: 'json' };
import { clone, get, seal } from './project-fixture.mjs';

const root = new URL('../', import.meta.url);
const model = await readArchitectureFile(
  new URL('models/rendering.json', root),
);
const graph = ArchitectureGraph.validate(model);
const run = (args) =>
  spawnSync(process.execPath, ['src/cli.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });

test('documentation uses every component and original interaction, with stable links and bytes', async () => {
  const strings = JSON.parse(
    await fs.readFile(new URL('assets/archivarius-strings.json', root), 'utf8'),
  );
  const markdown = await generateDocumentation(model);
  assert.equal(markdown, renderDocumentation(model, strings));
  assert.equal(markdown, await generateDocumentation(model));
  for (const node of graph.nodes.values()) {
    assert(markdown.includes('<a id="node-' + node.key + '"></a>'));
    assert(markdown.includes(node.summary));
    for (const rule of node.rules) assert(markdown.includes(rule.text));
  }
  for (const edge of model.relations) {
    assert.equal(
      markdown.split('<a id="relation-' + edge.key + '"></a>').length,
      2,
    );
    assert(markdown.includes(edge.payload));
    assert(markdown.includes(edge.meaning));
  }
  const anchors = new Set(
    [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]),
  );
  for (const match of markdown.matchAll(/\]\(#([^)]+)\)/g))
    assert(anchors.has(match[1]), match[1]);
  assert((await generateDocumentation(model)).includes('Fully implemented'));
});

test('documentation preserves boundaries and evidence, escapes markup, and refuses invalid models', async () => {
  const data = structuredClone(model);
  data.nodes[0].example =
    '<script>alert(1)</script>\n![x](javascript:alert(1))\n# injected';
  data.nodes[0].implementationEvidence = 'rev-123';
  const doc = await generateDocumentation(data);
  assert(!doc.includes('<script>'));
  assert(!doc.includes('![x]'));
  assert(!doc.includes('\n# injected'));
  assert(doc.includes('&lt;script&gt;'));
  assert(doc.includes('rev-123'), 'evidence must stay readable, not escaped');
  assert(doc.includes(data.nodes[0].detailNote));
  assert(!doc.includes('\\.'), 'sentence periods must not be escaped');
  data.relations[0].to = 'absent';
  await assert.rejects(generateDocumentation(data), { code: 'INVALID_MODEL' });
});

// A record field is content, never markup: markup, a link or a script stored in
// the model must reach every generated document as text a reader sees and a
// renderer does not run.
const hostile = [
  'MARKA [x](https://example.com)',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '# MARKB heading',
  'MARKC | pipe',
  '```MARKD',
  'MARKE setext',
  '===',
  'MARKZ "q" --> ; end',
].join('\n');
const diagramHostile = 'MARKM "q" --> x; y';

const inert = (out, where) => {
  const why = (reason) => where + ': ' + reason;
  assert(!out.includes('<script'), why('raw script tag'));
  assert(!out.includes('<img'), why('raw html tag'));
  assert(
    out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
    why('the script must survive as text'),
  );
  assert(!out.includes('MARKA [x]('), why('active link syntax'));
  assert(
    out.includes('MARKA \\[x\\](https://example.com)'),
    why('the link must survive as text'),
  );
  assert(!/^\s*#+ MARKB/m.test(out), why('heading from content'));
  assert(!out.includes('MARKC | pipe'), why('table cell from content'));
  assert(!out.includes('```MARKD'), why('code fence from content'));
  assert(!/^=+$/m.test(out), why('setext heading from content'));
  assert(out.includes('--&gt;'), why('the arrow must survive as text'));
};

test('the documentation renderer draws markup, a link and a script in a record as text', async () => {
  const data = structuredClone(model);
  data.nodes[0].title = diagramHostile;
  data.nodes[0].summary = hostile;
  data.nodes[0].example = hostile;
  data.nodes[0].rules[0].text = hostile;
  data.relations[0].payload = hostile;
  data.relations[0].meaning = hostile;
  const out = await generateDocumentation(data);
  inert(out, 'documentation');
  assert(out.includes('](#node-' + data.nodes[0].key + ')'), 'links must hold');
});

test('the reference renderer draws markup, a link and a script in a record as text', async () => {
  const data = clone();
  data.records.push(...structuredClone(documentRecords));
  Object.assign(get(data, 'row-limit'), { rule: hostile });
  get(data, 'streaming').because = hostile;
  get(data, 'within-limit').assertion = hostile;
  const out = await generateDocumentation(seal(data));
  inert(out, 'reference');
  const rows = out.split('\n').filter((row) => row.startsWith('| '));
  assert(
    rows.some((row) => row.includes('MARKA') && row.includes('MARKZ')),
    'a hostile cell must stay one table row',
  );
});

test('a hostile record title stays one mermaid label', () => {
  const statements = architectureDiagram(clone()).join('\n').split('\n');
  const data = clone();
  get(data, 'screen').title = diagramHostile;
  get(data, 'request').title = diagramHostile;
  const drawn = architectureDiagram(seal(data)).join('\n').split('\n');
  assert.equal(drawn.length, statements.length, 'the diagram gained a line');
  const labels = drawn.filter((line) => line.includes('MARKM'));
  assert.equal(labels.length, 2, 'expected a node label and an edge label');
  for (const label of labels) {
    assert(!label.includes('"q"'), 'a quote must not close the label');
    assert(label.includes('#quot;q#quot;'), 'a quote must be escaped');
    assert.equal(label.split('MARKM').length, 2, 'the label must stay one');
  }
});

test('CLI validates whole models, detects documentation drift and preserves files on rejection', async () => {
  await fs.mkdir(new URL('.runtime/', root), { recursive: true });
  const directory = await fs.mkdtemp(new URL('.runtime/documents-', root));
  const input = directory + '/model.json',
    output = directory + '/architecture.md';
  const serialized = JSON.stringify(model);
  try {
    await fs.writeFile(input, serialized);
    const valid = run(['validate', input, '--json']);
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout), {
      valid: true,
      errors: [],
      diagnostics: [],
    });
    assert.equal(run(['reference', input, '--output', output]).status, 0);
    const original = await fs.readFile(output, 'utf8');
    assert.equal(original, await generateDocumentation(model));
    assert.equal(
      run(['reference', input, '--output', output, '--check']).status,
      0,
    );
    await fs.appendFile(output, '\nmanual change');
    assert.equal(
      run(['reference', input, '--output', output, '--check']).status,
      1,
    );
    assert((await fs.readFile(output, 'utf8')).endsWith('manual change'));
    assert.equal(run(['reference', input, '--output', output]).status, 0);
    assert.equal(await fs.readFile(output, 'utf8'), original);
    const broken = structuredClone(model);
    broken.relations = broken.relations.filter(
      (r) => r.from !== 'publisher' && r.to !== 'publisher',
    );
    await fs.writeFile(input, JSON.stringify(broken));
    const invalid = run(['validate', input, '--json']);
    assert.equal(invalid.status, 1);
    assert(
      JSON.parse(invalid.stdout).diagnostics.some(
        (d) => d.code === 'INTERACTION_REQUIRED',
      ),
    );
    assert.equal(run(['reference', input, '--output', output]).status, 1);
    assert.equal(await fs.readFile(output, 'utf8'), original);
    await fs.writeFile(input, serialized);
    assert.equal(run(['reference', input, '--output', input]).status, 1);
    const alias = directory + '/alias.json';
    await fs.symlink(input, alias);
    assert.equal(run(['reference', input, '--output', alias]).status, 1);
    assert.equal(await fs.readFile(input, 'utf8'), serialized);
    const changed = structuredClone(model);
    changed.nodes[0].summary += ' Changed.';
    await fs.writeFile(input, JSON.stringify(changed));
    assert.equal(
      run(['reference', input, '--output', output, '--check']).status,
      1,
    );
    assert.equal(run(['validate', input, '--unknown']).status, 2);
    assert.equal(run(['--help']).status, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// The help text is what a user reads and the model record is what an agent
// reads; a command that reaches one and not the other is drift nobody notices.
test('the help text and the documented CLI record name the same commands', async () => {
  const help = await fs.readFile(
    new URL('assets/archivarius-cli-help.txt', root),
    'utf8',
  );
  const commands = [...help.matchAll(/^\s+archivarius (\w[\w-]*)/gm)].map(
    (match) => match[1],
  );
  assert(commands.length > 1, 'the help must list the command surface');
  const project = JSON.parse(
    await fs.readFile(new URL('project.json', root), 'utf8'),
  );
  const summary = project.records.find(
    (record) => record.key === 'cli',
  ).summary;
  const named = [...summary.matchAll(/\b([a-z]+)\b/g)]
    .map((match) => match[1])
    .filter((word) => commands.includes(word));
  assert.deepEqual(
    commands.filter((command) => !named.includes(command)),
    [],
    'the cli record omits a command the help offers',
  );
});

// A binding says which file carries a part. That claim is checked on every run:
// the table must cover the described parts and each file must exist. The digest
// is a release claim about bytes, so it is not asserted here — bytes move between
// releases, and a gate on them would only teach an agent to refresh a number.
test('every described part of this repository is bound to a file that exists', async () => {
  const project = JSON.parse(
    await fs.readFile(new URL('project.json', root), 'utf8'),
  );
  const described = project.records
    .filter((record) =>
      ['scope', 'component', 'interaction', 'interface'].includes(record.type),
    )
    .map((record) => record.key)
    .sort();
  assert.deepEqual(Object.keys(project.bindings).sort(), described);
  // A part may rest on several files, and on a range within one, so the table is
  // compared claim for claim rather than path for path.
  const spelled = (entry) =>
    typeof entry === 'string' ? [entry] : entry.map((part) => part.path);
  for (const [key, binding] of Object.entries(project.bindings)) {
    assert.deepEqual(
      bindingParts(binding).map((part) => part.path),
      spelled(files[key]),
      key + ' is bound past the table',
    );
    for (const part of bindingParts(binding))
      assert.ok(
        await fs.readFile(new URL(part.path, root)),
        key + ' names a file this repository does not have',
      );
  }
});

// Bytes that moved since the release are not a failure, they are a reading list:
// the part whose file changed is the part whose description an agent must read
// again. Naming every part on every edit would make that list worthless.
test('changed bytes name the parts whose description needs a fresh read', () => {
  const project = {
    records: [
      { key: 'core', type: 'component' },
      { key: 'cli', type: 'component' },
    ],
    bindings: {
      core: { path: 'src/core.mjs', digest: 'old' },
      cli: { path: 'src/cli.mjs', digest: 'same' },
    },
  };
  const current = {
    core: { path: 'src/core.mjs', digest: 'new' },
    cli: { path: 'src/cli.mjs', digest: 'same' },
  };
  assert.deepEqual(staleParts(project, current), ['core']);
  assert.deepEqual(staleParts(project, project.bindings), []);
});
