import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';
import postcss from 'postcss';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');
await fs.rm(new URL('dist/', root), { recursive: true, force: true });
await fs.mkdir(new URL('dist/', root), { recursive: true });
await fs.cp(new URL('assets/', root), new URL('dist/assets/', root), {
  recursive: true,
});
for (const entry of await fs.readdir(new URL('src/', root), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || entry.name.endsWith('.css')) continue;
  const absolute = path.join(entry.parentPath, entry.name);
  const relative = path.relative(new URL('src/', root).pathname, absolute);
  const output = new URL('dist/src/' + relative.replace(/\.jsx$/, '.js'), root);
  await fs.mkdir(new URL('./', output), { recursive: true });
  let code = await fs.readFile(absolute, 'utf8');
  if (entry.name.endsWith('.jsx')) {
    code = (
      await transform(code, {
        loader: 'jsx',
        format: 'esm',
        target: 'es2022',
        jsx: 'transform',
      })
    ).code;
  }
  code = code.replace(/(from\s+['"][^'"]+)\.jsx(['"])/g, '$1.js$2');
  await fs.writeFile(output, code);
}

const css = postcss.parse(
  await read('node_modules/@xyflow/react/dist/style.css'),
);
css.walkAtRules(/keyframes$/, (rule) => {
  const name = rule.params;
  rule.params = 'archivarius-' + name;
  css.walkDecls(/^animation/, (decl) => {
    decl.value = decl.value.replace(
      new RegExp('\\b' + name + '\\b', 'g'),
      'archivarius-' + name,
    );
  });
});
css.walkRules((rule) => {
  if (rule.parent.type === 'atrule' && /keyframes$/.test(rule.parent.name))
    return;
  rule.selectors = rule.selectors.map((selector) => '.archivarius ' + selector);
});
const own = await read('src/styles.css');
await fs.writeFile(
  new URL('dist/style.css', root),
  css.toString() + '\n' + own,
);
