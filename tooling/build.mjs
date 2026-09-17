import fs from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';
import postcss from 'postcss';
import './generate-contract.mjs';

const root = new URL('../', import.meta.url);
const read = (name) => fs.readFile(new URL(name, root), 'utf8');
await fs.rm(new URL('dist/', root), { recursive: true, force: true });
await fs.mkdir(new URL('dist/', root), { recursive: true });
// Agent instructions are project-internal and must not reach a consumer's
// node_modules, in `assets/` any more than in `src/`.
const shipped = (source) => !source.endsWith('AGENTS.md');
await fs.cp(new URL('assets/', root), new URL('dist/assets/', root), {
  recursive: true,
  filter: shipped,
});
await fs.copyFile(
  new URL('models/documentation.json', root),
  new URL('dist/example.json', root),
);
for (const entry of await fs.readdir(new URL('src/', root), {
  recursive: true,
  withFileTypes: true,
})) {
  // Stylesheets are scoped and concatenated below; no Markdown belongs in
  // compiled output.
  if (!entry.isFile() || /\.(?:css|md)$/.test(entry.name)) continue;
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
        jsx: 'automatic',
        jsxImportSource: 'react',
      })
    ).code;
  }
  code = code.replace(/(from\s+['"][^'"]+)\.jsx(['"])/g, '$1.js$2');
  await fs.writeFile(output, code);
}
await fs.chmod(new URL('dist/src/cli.mjs', root), 0o755);

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
  rule.selectors = rule.selectors.map((selector) => {
    // A vendored selector outside the mount point cannot be scoped, so an
    // upgrade that introduces one fails the build instead of leaking globally.
    if (/^(:root\b|html\b|body\b|\*(\s|$|,))/.test(selector.trim()))
      throw new Error('UNSCOPABLE_VENDOR_SELECTOR: ' + selector);
    return '.archivarius ' + selector;
  });
});
const own = await read('src/ui/styles.css');
await fs.writeFile(
  new URL('dist/style.css', root),
  css.toString() + '\n' + own,
);
