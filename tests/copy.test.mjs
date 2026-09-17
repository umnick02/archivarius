import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { failureCodes } from '../src/model/errors.mjs';

// The shipped copy and the modules that read it are one surface: a key the
// interface asks for must exist, a key nobody asks for is dead weight, and the
// file stays English. Every failure names the key and the file that holds it.
const root = new URL('../', import.meta.url);
const COPY = 'assets/archivarius-strings.json';
const copy = JSON.parse(await fs.readFile(new URL(COPY, root), 'utf8'));

const readers = new Map();
for (const name of [
  ...(await fs.readdir(new URL('src/ui/', root)))
    .filter((entry) => /\.(jsx|mjs)$/.test(entry))
    .map((entry) => 'src/ui/' + entry),
  // node.mjs hands strings.json to the document renderer, so it reads the same
  // copy object the browser surface does.
  'src/model/document.mjs',
])
  readers.set(name, await fs.readFile(new URL(name, root), 'utf8'));

const group = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const leaves = (value, path = []) =>
  group(value)
    ? Object.entries(value).flatMap(([key, child]) =>
        leaves(child, [...path, key]),
      )
    : [path.join('.')];
const groups = (value = copy, path = []) =>
  group(value)
    ? [
        [path.join('.'), value],
        ...Object.values(value).flatMap((child, index) =>
          groups(child, [...path, Object.keys(value)[index]]),
        ),
      ]
    : [];
const at = (source, index) => source.slice(0, index).split('\n').length;

// `useArchitecture()` hands out the shipped copy as `copy` and the project copy
// as `projectCopy`; either may be renamed, and `projectCopy: copy` rebinds the
// plain name, so the local name of the shipped copy is resolved per file.
const bound = (source, field) => {
  const names = new Set();
  for (const [, block] of source.matchAll(
    /\{([^{}]*)\}\s*=\s*useArchitecture\(\)/g,
  )) {
    const alias = block.match(new RegExp('\\b' + field + '\\s*:\\s*(\\w+)'));
    if (alias) names.add(alias[1]);
    else if (new RegExp('\\b' + field + '\\b').test(block)) names.add(field);
  }
  return names;
};
const rootsOf = (source) => {
  const project = bound(source, 'projectCopy');
  const names = bound(source, 'copy');
  // A module that takes the copy object as an argument names it `copy`, and the
  // map keeps the loaded copy on a holder it reads as `<holder>.copy`.
  if (/\(\s*(?:[^()]*,\s*)?copy\s*[,)]/.test(source) || /\.copy\./.test(source))
    names.add('copy');
  return [...names].filter(
    (name) => name !== 'projectCopy' && !project.has(name),
  );
};

// The renderer's copy object is strings.json plus the project panel copy that
// node.mjs and the about panel attach as `project`; that namespace is not
// shipped UI copy.
const INJECTED = new Set(['project']);

const missing = [];
const seen = new Set();
for (const [file, source] of readers)
  for (const name of rootsOf(source)) {
    const access = new RegExp('\\b' + name + '((?:\\s*\\??\\.\\s*\\w+)*)', 'g');
    for (const hit of source.matchAll(access)) {
      const segments = hit[1].replace(/[\s?]/g, '').split('.').filter(Boolean);
      let value = copy;
      const path = [];
      let broken = false;
      for (const segment of segments) {
        // A string or a list ends the copy path; what follows it is JavaScript.
        if (!group(value)) break;
        if (!Object.hasOwn(value, segment)) {
          if (!(path.length === 0 && INJECTED.has(segment)))
            missing.push(
              file +
                ':' +
                at(source, hit.index) +
                ' reads copy key "' +
                [...path, segment].join('.') +
                '" that ' +
                COPY +
                ' does not hold',
            );
          broken = true;
          break;
        }
        value = value[segment];
        path.push(segment);
      }
      // A group reached whole or indexed dynamically reads all of its keys.
      if (!broken && path.length)
        for (const leaf of leaves(value, path)) seen.add(leaf);
    }
  }

test('every copy key the interface reads exists in the shipped copy', () => {
  assert.deepEqual(missing, []);
});

// A key nothing reads still ships, still needs review and still lies about what
// the interface can show. `errors` is indexed by failure code, so its own keys
// are held to the codes the library can actually produce.
test('every key in the shipped copy is read by a module', async () => {
  const dead = leaves(copy)
    .filter((key) => !seen.has(key))
    .map((key) => COPY + ' holds copy key "' + key + '" that no module reads');
  const sources = await Promise.all(
    (await fs.readdir(new URL('src/', root), { recursive: true }))
      .filter((entry) => /\.(mjs|jsx)$/.test(entry))
      .map((entry) => fs.readFile(new URL('src/' + entry, root), 'utf8')),
  );
  const produced = sources.join('\n');
  for (const code of Object.keys(copy.errors))
    if (!Object.hasOwn(failureCodes, code) && !produced.includes(code))
      dead.push(
        COPY +
          ' holds copy key "errors.' +
          code +
          '" for a failure code no module in src/ can produce',
      );
  assert.deepEqual(dead, []);
});

// context.jsx selects a form with `Intl.PluralRules(copy.locale).select`, so a
// pluralized group answers for exactly the forms that locale can ask for.
test('every pluralized entry holds both plural forms and nothing else', () => {
  const forms = new Intl.PluralRules(copy.locale).resolvedOptions()
    .pluralCategories;
  const problems = [];
  for (const [path, value] of groups()) {
    const keys = Object.keys(value);
    if (!keys.some((key) => forms.includes(key))) continue;
    for (const form of ['one', 'other'])
      if (!keys.includes(form))
        problems.push(
          COPY + ' plural group "' + path + '" has no "' + form + '" form',
        );
    for (const key of keys)
      if (!forms.includes(key))
        problems.push(
          COPY +
            ' plural group "' +
            path +
            '" holds "' +
            key +
            '", which is not a plural form of ' +
            copy.locale,
        );
  }
  assert.deepEqual(problems, []);
  assert.deepEqual([...forms].sort(), ['one', 'other']);
});

// One language, one copy file: `locale` is stated once, at the root, and no key
// anywhere names a second locale. A bare two-letter key is not read as a locale
// tag — English copy keys look like that (`to`, `up`).
test('the shipped copy is English and names no other locale', () => {
  assert.equal(copy.locale, 'en');
  const problems = [];
  for (const [path, value] of groups())
    for (const key of Object.keys(value)) {
      const full = path ? path + '.' + key : key;
      if (/^(locales|lang|language|i18n|translations?|messages)$/i.test(key))
        problems.push(COPY + ' holds locale key "' + full + '"');
      if (key === 'locale' && path)
        problems.push(COPY + ' holds a second locale at "' + full + '"');
      if (/^[A-Za-z]{2,3}[-_][A-Za-z]{2,4}$/.test(key))
        problems.push(COPY + ' holds locale-tagged key "' + full + '"');
    }
  assert.deepEqual(problems, []);
});

// Copy owns every word the interface shows. Checked: literal JSX text and the
// literal value of an attribute that renders text. Not copy, and not checked:
// `role`, `data-*`, `className`, element ids, URLs and CSS values.
const TEXT_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
];
const CODE = /[(){}[\];=&|'"`<>]/;
const WORD = /[A-Za-z]{2,}/;
const balanced = (text) => {
  let out = text,
    previous;
  do {
    previous = out;
    out = out.replace(/\{[^{}]*\}/g, '');
  } while (out !== previous);
  return out;
};

test('no component holds a user-visible string copy owns', () => {
  const problems = [];
  for (const [file, source] of readers) {
    if (!file.startsWith('src/ui/')) continue;
    for (const hit of source.matchAll(/>([^<>]*)</g)) {
      // A tag ends with its own last character or opens the line it closes on;
      // `a > b` and `=>` are operators, and a run holding JavaScript
      // punctuation is code, not a text child.
      const head = source.slice(0, hit.index);
      const line = head.slice(head.lastIndexOf('\n') + 1);
      if (line.trim() && /[\s=!<>+\-*/%?:,&|]$/.test(line)) continue;
      const text = balanced(hit[1]);
      if (CODE.test(text) || !WORD.test(text)) continue;
      problems.push(
        file +
          ':' +
          at(source, hit.index) +
          ' renders the literal text "' +
          text.trim() +
          '" instead of a key from ' +
          COPY,
      );
    }
    for (const attribute of TEXT_ATTRIBUTES)
      for (const hit of source.matchAll(
        new RegExp(attribute + '=\\{?\\s*(["\'])(.*?)\\1', 'g'),
      ))
        if (WORD.test(hit[2]))
          problems.push(
            file +
              ':' +
              at(source, hit.index) +
              ' sets ' +
              attribute +
              ' to the literal text "' +
              hit[2] +
              '" instead of a key from ' +
              COPY,
          );
  }
  assert.deepEqual(problems, []);
});
