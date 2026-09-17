// The dependency a module really has is written in its text, so reading it needs
// no filesystem: text in, edges out. A regular expression cannot do this job —
// `import` reads the same inside a string, a comment, a template and the middle
// of `important` — so the text is walked once as characters and reduced to the
// tokens that are code, and only those tokens are asked for specifiers.

/**
 * One dependency a module states: the specifier as written, that specifier
 * resolved to a repository-relative path when it is relative (left as the
 * package name when it is not, which `bare` says), and the form it was written
 * in.
 *
 * @typedef {{ specifier: string, target: string, bare: boolean,
 *   form: 'static' | 'export' | 'dynamic' }} ModuleImport
 */

/**
 * A piece of the text that is code: a word (identifier, keyword or number), one
 * punctuation character, a string whose value is known, or something opaque that
 * is neither — a template that interpolates, which can never be a literal
 * specifier.
 *
 * @typedef {{ kind: 'word' | 'punct' | 'string' | 'opaque', value: string }} Token
 */

const idStart = /[A-Za-z_$0-9]/;
const idPart = /[\w$]/;

// A slash opens a regular expression only where a value cannot already have
// ended. After a word that is not one of these keywords, after a string, and
// after a closing bracket, it divides.
const beforeRegex = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'do',
  'else',
  'yield',
  'await',
  'case',
  'throw',
]);

/** @param {Token | undefined} previous @returns {boolean} */
const regexAllowed = (previous) => {
  if (!previous) return true;
  if (previous.kind === 'word') return beforeRegex.has(previous.value);
  if (previous.kind === 'punct')
    return previous.value !== ')' && previous.value !== ']';
  return false;
};

/**
 * Read a quoted string from `at`, which holds its opening quote.
 *
 * @param {string} text @param {number} at
 * @returns {{ end: number, value: string }}
 */
function readString(text, at) {
  const quote = text[at];
  let value = '';
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === quote) return { end: i + 1, value };
    if (c === '\n') break;
    value += c;
    i += 1;
  }
  return { end: i, value };
}

/**
 * Read a template literal from `at`, which holds its backtick. A template that
 * interpolates has no value a specifier could be read from, so it comes back
 * with `value` unset; the characters it spans are code to no one either way.
 *
 * @param {string} text @param {number} at
 * @returns {{ end: number, value?: string }}
 */
function readTemplate(text, at) {
  let value = '';
  let interpolates = false;
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      value += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === '`') {
      i += 1;
      return interpolates ? { end: i } : { end: i, value };
    }
    if (c === '$' && text[i + 1] === '{') {
      interpolates = true;
      i = skipSubstitution(text, i + 2);
      continue;
    }
    value += c;
    i += 1;
  }
  return { end: i };
}

/**
 * Walk past a `${ ... }` substitution, which may hold anything — including more
 * strings, templates and comments with braces in them.
 *
 * @param {string} text @param {number} at @returns {number}
 */
function skipSubstitution(text, at) {
  let depth = 1;
  let i = at;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (!depth) return i + 1;
    } else if (c === '"' || c === "'") {
      i = readString(text, i).end;
      continue;
    } else if (c === '`') {
      i = readTemplate(text, i).end;
      continue;
    } else if (c === '/' && text[i + 1] === '/') {
      const line = text.indexOf('\n', i);
      i = line === -1 ? text.length : line;
      continue;
    } else if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    i += 1;
  }
  return i;
}

/**
 * Read a regular expression literal from `at`, which holds its opening slash. A
 * literal cannot cross a line, so a slash with no partner before the newline was
 * a division and this comes back with nothing.
 *
 * @param {string} text @param {number} at @returns {number | null}
 */
function readRegex(text, at) {
  let inClass = false;
  let i = at + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '\n') return null;
    if (inClass) {
      if (c === ']') inClass = false;
    } else if (c === '[') inClass = true;
    else if (c === '/') {
      i += 1;
      while (i < text.length && idPart.test(text[i])) i += 1;
      return i;
    }
    i += 1;
  }
  return null;
}

/**
 * Reduce a module's text to the tokens that are code. Comments, the insides of
 * strings and templates, and regular expressions are not code, so nothing in
 * them can become an edge.
 *
 * @param {string} text @returns {Token[]}
 */
function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const line = text.indexOf('\n', i);
      i = line === -1 ? text.length : line;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    if (c === '/' && regexAllowed(tokens[tokens.length - 1])) {
      const end = readRegex(text, i);
      if (end !== null) {
        i = end;
        continue;
      }
    }
    if (c === '"' || c === "'") {
      const read = readString(text, i);
      tokens.push({ kind: 'string', value: read.value });
      i = read.end;
      continue;
    }
    if (c === '`') {
      const read = readTemplate(text, i);
      tokens.push(
        read.value === undefined
          ? { kind: 'opaque', value: '`' }
          : { kind: 'string', value: read.value },
      );
      i = read.end;
      continue;
    }
    if (idStart.test(c)) {
      let end = i + 1;
      while (end < text.length && idPart.test(text[end])) end += 1;
      tokens.push({ kind: 'word', value: text.slice(i, end) });
      i = end;
      continue;
    }
    if (!/\s/.test(c)) tokens.push({ kind: 'punct', value: c });
    i += 1;
  }
  return tokens;
}

// A clause names its module after `from`. The scan stops where a clause cannot
// still be running: at a statement end, at an assignment, at a call, or at the
// next import or export.
/** @param {Token[]} tokens @param {number} at @returns {string | null} */
function clauseSpecifier(tokens, at) {
  for (let j = at; j < tokens.length; j += 1) {
    const token = tokens[j];
    if (
      token.kind === 'punct' &&
      (token.value === ';' || token.value === '=' || token.value === '(')
    )
      return null;
    if (
      token.kind === 'word' &&
      (token.value === 'import' || token.value === 'export')
    )
      return null;
    if (token.kind === 'word' && token.value === 'from') {
      const next = tokens[j + 1];
      return next && next.kind === 'string' ? next.value : null;
    }
  }
  return null;
}

const isRelative = (specifier) =>
  specifier.startsWith('./') || specifier.startsWith('../');

/**
 * Resolve a relative specifier against the module that wrote it, in the
 * repository-relative vocabulary both sides of a reconciliation speak.
 *
 * @param {string} path @param {string} specifier @returns {string}
 */
function resolveFrom(path, specifier) {
  const at = path.lastIndexOf('/');
  const segments = at === -1 ? [] : path.slice(0, at).split('/');
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

/**
 * Every dependency a module's text states, in the order it states them: static
 * imports, republishing exports, and dynamic imports whose specifier is a
 * literal.
 *
 * @param {string} text the module's source
 * @param {string} path the module's repository-relative path
 * @returns {ModuleImport[]}
 */
export function readImports(text, path) {
  const tokens = tokenize(text);
  /** @type {ModuleImport[]} */
  const found = [];
  /** @param {ModuleImport['form']} form @param {string} specifier */
  const add = (form, specifier) => {
    const relative = isRelative(specifier);
    found.push({
      specifier,
      target: relative ? resolveFrom(path, specifier) : specifier,
      bare: !relative,
      form,
    });
  };
  for (const [i, token] of tokens.entries()) {
    if (token.kind !== 'word') continue;
    const previous = tokens[i - 1];
    // A property named import or export belongs to an object, not to a module.
    if (previous && previous.kind === 'punct' && previous.value === '.')
      continue;
    const next = tokens[i + 1];
    if (token.value === 'import') {
      if (!next) continue;
      // import.meta states no dependency.
      if (next.kind === 'punct' && next.value === '.') continue;
      if (next.kind === 'string') {
        add('static', next.value);
        continue;
      }
      if (next.kind === 'punct' && next.value === '(') {
        const argument = tokens[i + 2];
        if (argument && argument.kind === 'string')
          add('dynamic', argument.value);
        continue;
      }
      const specifier = clauseSpecifier(tokens, i + 1);
      if (specifier !== null) add('static', specifier);
    } else if (token.value === 'export') {
      const specifier = clauseSpecifier(tokens, i + 1);
      if (specifier !== null) add('export', specifier);
    }
  }
  return found;
}

/**
 * The edge list a set of modules states, one edge per distinct dependency: what
 * a reconciliation calls the observed graph.
 *
 * @param {Iterable<{ path: string, text: string }>} modules
 * @returns {Array<{ from: string, to: string }>}
 */
export function observeImports(modules) {
  /** @type {Array<{ from: string, to: string }>} */
  const edges = [];
  for (const module of modules) {
    const seen = new Set();
    for (const entry of readImports(module.text, module.path)) {
      if (entry.target === module.path || seen.has(entry.target)) continue;
      seen.add(entry.target);
      edges.push({ from: module.path, to: entry.target });
    }
  }
  return edges;
}
