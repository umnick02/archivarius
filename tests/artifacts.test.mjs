import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import Ajv2020 from 'ajv/dist/2020.js';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');

test('package retains external data resources and project-independent scripts', async () => {
  const shipped = await fs.readdir(new URL('dist/assets/', root));
  assert(
    !shipped.includes('AGENTS.md'),
    'agent instructions must not reach a consumer',
  );
  for (const file of await fs.readdir(new URL('assets/', root))) {
    if (file === 'AGENTS.md') continue;
    assert(shipped.includes(file), file);
    assert.equal(
      await read('assets/' + file),
      await read('dist/assets/' + file),
    );
  }
  const model = JSON.parse(await read('models/rendering.json'));
  const copy = JSON.parse(await read('assets/archivarius-strings.json'));
  let scripts = '';
  for (const file of await fs.readdir(new URL('dist/src/', root), {
    recursive: true,
  }))
    if (/\.(?:m?js)$/.test(file)) scripts += await read('dist/src/' + file);
  for (const node of model.nodes) assert(!scripts.includes(node.title));
  assert(!scripts.includes(copy.interpretationNote));
  const projectCopy = JSON.parse(
    await read('assets/archivarius-project-strings.json'),
  );
  const project = JSON.parse(await read('models/documentation.json'));
  assert(!scripts.includes(projectCopy.conservative));
  assert(
    !scripts.includes(
      project.records.find((record) => record.type === 'requirement').rule,
    ),
  );
  assert(!scripts.includes('Strategy Lab'));
  assert(!scripts.includes('window.architectureMap'));
  assert(!scripts.includes("document.addEventListener('keydown'"));
});

test('every stylesheet the surface owns is in the packaged CSS', async () => {
  const bundle = await read('dist/style.css');
  const sheets = (
    await fs.readdir(new URL('../src/ui/', import.meta.url))
  ).filter((name) => name.endsWith('.css'));
  assert(sheets.length, 'the surface owns no stylesheet');
  for (const sheet of sheets) {
    const text = await read('src/ui/' + sheet);
    const rule = text
      .split('\n')
      .find((line) => line.trim().startsWith('.archivarius'));
    assert(rule, sheet + ' carries no scoped rule');
    assert(bundle.includes(rule.trim()), sheet + ' is not bundled');
  }
});

test('packaged CSS is confined to map containers, including animations', async () => {
  const css = postcss.parse(await read('dist/style.css'));
  css.walkRules((rule) => {
    if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name))
      return;
    for (const selector of rule.selectors)
      assert(selector.startsWith('.archivarius'), selector);
  });
  css.walkAtRules(/keyframes$/, (rule) =>
    assert(rule.params.startsWith('archivarius-')),
  );
});

test('a consumer can compile the shipped schemas, extensions and all', async () => {
  // The schemas carry two annotations that no validator implements, so a
  // consumer needs ajv's strict mode off. Pin that surface: a third extension
  // would break every consumer that followed contract.md and passed only this.
  const schemas = ['model', 'change'].map(
    (name) => 'archivarius-' + name + '.schema.json',
  );
  const extensions = new Set();
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('x-')) extensions.add(key);
      collect(child);
    }
  };
  const ajv = new Ajv2020({ strict: false });
  for (const name of schemas) {
    const schema = JSON.parse(await read('dist/assets/' + name));
    collect(schema);
    ajv.addSchema(schema, name);
  }
  for (const name of schemas) ajv.compile({ $ref: name });
  assert.deepEqual([...extensions].sort(), ['x-history', 'x-targets']);
  const documented = await read('dist/assets/archivarius-contract.md');
  for (const keyword of extensions) assert(documented.includes(keyword));
});
