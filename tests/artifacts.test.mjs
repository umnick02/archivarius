import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');

test('package retains external data resources and project-independent scripts', async () => {
  for (const file of await fs.readdir(new URL('assets/', root)))
    assert.equal(
      await read('assets/' + file),
      await read('dist/assets/' + file),
    );
  const model = JSON.parse(
    await read('examples/basic/public/architecture.json'),
  );
  const copy = JSON.parse(await read('assets/ru.json'));
  let scripts = '';
  for (const file of await fs.readdir(new URL('dist/src/', root), {
    recursive: true,
  }))
    if (/\.(?:m?js)$/.test(file)) scripts += await read('dist/src/' + file);
  for (const node of model.nodes) assert(!scripts.includes(node.title));
  assert(!scripts.includes(copy.interpretationNote));
  const projectCopy = JSON.parse(await read('assets/project.ru.json'));
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

test('locale resources cover the same UI and validation vocabulary', async () => {
  const ru = JSON.parse(await read('assets/ru.json'));
  const en = JSON.parse(await read('assets/en.json'));
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  assert.deepEqual(
    Object.keys(ru.errors).sort(),
    Object.keys(en.errors).sort(),
  );
  assert(ru.relationCounts.many && en.relationCounts.other);
  assert.equal(
    JSON.parse(await read('assets/contracts.json')).length,
    JSON.parse(await read('assets/contracts.en.json')).length,
  );
  const projectRu = JSON.parse(await read('assets/project.ru.json'));
  const projectEn = JSON.parse(await read('assets/project.en.json'));
  for (const key of ['types', 'fields', 'values', 'reasonsByCode'])
    assert.deepEqual(
      Object.keys(projectRu[key]).sort(),
      Object.keys(projectEn[key]).sort(),
    );
  assert.equal(projectRu.contracts.length, projectEn.contracts.length);
});
