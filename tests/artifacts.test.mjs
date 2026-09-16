import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';

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
  const model = JSON.parse(
    await read('examples/basic/public/architecture.json'),
  );
  const copy = JSON.parse(await read('assets/strings.json'));
  let scripts = '';
  for (const file of await fs.readdir(new URL('dist/src/', root), {
    recursive: true,
  }))
    if (/\.(?:m?js)$/.test(file)) scripts += await read('dist/src/' + file);
  for (const node of model.nodes) assert(!scripts.includes(node.title));
  assert(!scripts.includes(copy.interpretationNote));
  const projectCopy = JSON.parse(await read('assets/project.json'));
  const project = JSON.parse(await read('examples/basic/public/project.json'));
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
