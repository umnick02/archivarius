import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateDocumentation, readArchitectureFile } from '../src/node.mjs';
import { renderDocumentation } from '../src/model/document.mjs';
import { ArchitectureGraph } from '../src/model/graph.mjs';

const root = new URL('../', import.meta.url);
const model = await readArchitectureFile(
  new URL('examples/basic/public/architecture.json', root),
);
const graph = ArchitectureGraph.validate(model);
const run = (args) =>
  spawnSync(process.execPath, ['src/cli.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
  });

test('documentation uses every component and original interaction, with stable links and bytes', async () => {
  const strings = JSON.parse(
    await fs.readFile(new URL('assets/strings.json', root), 'utf8'),
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
    assert.equal(run(['docs', input, '--output', output]).status, 0);
    const original = await fs.readFile(output, 'utf8');
    assert.equal(original, await generateDocumentation(model));
    assert.equal(run(['docs', input, '--output', output, '--check']).status, 0);
    await fs.appendFile(output, '\nmanual change');
    assert.equal(run(['docs', input, '--output', output, '--check']).status, 1);
    assert((await fs.readFile(output, 'utf8')).endsWith('manual change'));
    assert.equal(run(['docs', input, '--output', output]).status, 0);
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
    assert.equal(run(['docs', input, '--output', output]).status, 1);
    assert.equal(await fs.readFile(output, 'utf8'), original);
    await fs.writeFile(input, serialized);
    assert.equal(run(['docs', input, '--output', input]).status, 1);
    const alias = directory + '/alias.json';
    await fs.symlink(input, alias);
    assert.equal(run(['docs', input, '--output', alias]).status, 1);
    assert.equal(await fs.readFile(input, 'utf8'), serialized);
    const changed = structuredClone(model);
    changed.nodes[0].summary += ' Changed.';
    await fs.writeFile(input, JSON.stringify(changed));
    assert.equal(run(['docs', input, '--output', output, '--check']).status, 1);
    assert.equal(run(['validate', input, '--unknown']).status, 2);
    assert.equal(run(['--help']).status, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

// The help text is what a user reads and the model record is what an agent
// reads; a command that reaches one and not the other is drift nobody notices.
test('the help text and the documented CLI record name the same commands', async () => {
  const help = await fs.readFile(new URL('assets/cli-help.txt', root), 'utf8');
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
