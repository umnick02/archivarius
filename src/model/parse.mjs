import { visit } from 'jsonc-parser';
import { ArchitectureError } from './errors.mjs';
import { ArchitectureGraph } from './graph.mjs';
import { validateProject } from './project-contract.mjs';

/**
 * The bounds an input has to stay inside to be read at all, in the units a
 * caller can measure before it hands anything over.
 *
 * @typedef {{ maxBytes: number, maxRecords: number, maxRelations: number,
 *   maxDepth: number }} Limits
 * @typedef {import('./errors.mjs').Diagnostic} Diagnostic
 */

/** @type {Readonly<Limits>} */
export const architectureLimits = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxRecords: 20000,
  maxRelations: 10000,
  maxDepth: 32,
});

const issue = (bound, value) =>
  `${bound} ${value} is past the stated maximum ${architectureLimits[bound]}`;

/** @returns {Diagnostic} */
const note = (bound, value) => ({
  code: 'LIMIT_EXCEEDED',
  path: '',
  params: {
    bound,
    value: String(value),
    limit: String(architectureLimits[bound]),
  },
});

// UTF-8 length of a string without holding a second copy of it: the count stops
// as soon as it is past the bound, and a chunk never splits a surrogate pair.
function utf8Length(text, limit) {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + 0x10000, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    bytes += encoder.encode(text.slice(start, end)).length;
    if (bytes > limit) return bytes;
    start = end;
  }
  return bytes;
}

/**
 * The byte bound, checked before the text is scanned: an oversized input is
 * refused by name instead of being walked until the tab gives up.
 */
export function assertTextLimits(text) {
  const bytes = utf8Length(text, architectureLimits.maxBytes);
  if (bytes > architectureLimits.maxBytes)
    throw new ArchitectureError(
      'MODEL_TOO_LARGE',
      [issue('maxBytes', bytes)],
      [note('maxBytes', bytes)],
    );
  return text;
}

/**
 * The shape bounds, checked before validation and before layout: one walk of the
 * containment tree counts the records, the relations and the nesting depth, and
 * whichever bound the input is past names itself and the value it carried.
 */
export function assertArchitectureLimits(model) {
  if (!model || typeof model !== 'object') return model;
  const relations = Array.isArray(model.relations) ? model.relations.length : 0;
  let records =
    relations + (Array.isArray(model.records) ? model.records.length : 0);
  let depth = 0;
  // A caller's object may be cyclic and an input may be far deeper than the
  // bound, so the walk is iterative and never reads the same node twice.
  const seen = new Set();
  let level = Array.isArray(model.nodes) ? model.nodes : [];
  while (level.length) {
    depth += 1;
    const next = [];
    for (const node of level) {
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      records += 1;
      if (Array.isArray(node.children)) next.push(...node.children);
    }
    level = next;
  }
  if (relations > architectureLimits.maxRelations)
    throw new ArchitectureError(
      'MODEL_TOO_MANY_RELATIONS',
      [issue('maxRelations', relations)],
      [note('maxRelations', relations)],
    );
  if (depth > architectureLimits.maxDepth)
    throw new ArchitectureError(
      'MODEL_TOO_DEEP',
      [issue('maxDepth', depth)],
      [note('maxDepth', depth)],
    );
  if (records > architectureLimits.maxRecords)
    throw new ArchitectureError(
      'MODEL_TOO_MANY_RECORDS',
      [issue('maxRecords', records)],
      [note('maxRecords', records)],
    );
  return model;
}

export function validateArchitecture(model) {
  if (model?.version === 4) return validateProject(model);
  const { errors, diagnostics } = ArchitectureGraph.validate(model);
  return { valid: errors.length === 0, errors, diagnostics };
}

/**
 * @param {string} text
 * @param {{ signal?: AbortSignal }} [options]
 */
export function parseJSON(text, { signal } = {}) {
  // Reading is a sequence of synchronous stages, so a withdrawn caller is
  // refused at each boundary rather than mid-scan: nothing can abort a stage
  // that is already running.
  signal?.throwIfAborted();
  if (typeof text !== 'string') throw new ArchitectureError('INVALID_JSON');
  assertTextLimits(text);
  const diagnostics = [],
    objects = [];
  visit(
    text,
    {
      onObjectBegin: () => {
        objects.push(new Set());
      },
      onObjectEnd: () => {
        objects.pop();
      },
      onObjectProperty(property, offset, length, line, column, path) {
        const keys = objects.at(-1);
        if (keys.has(property))
          diagnostics.push({
            code: 'DUPLICATE_PROPERTY',
            path:
              '/' +
              [...path(), property]
                .map((part) =>
                  String(part).replaceAll('~', '~0').replaceAll('/', '~1'),
                )
                .join('/'),
            params: { line: line + 1, column: column + 1 },
          });
        keys.add(property);
      },
      onError(error, offset, length, line, column) {
        diagnostics.push({
          code: 'INVALID_JSON',
          path: '',
          params: { error, line: line + 1, column: column + 1 },
        });
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    },
  );
  if (diagnostics.length)
    throw new ArchitectureError(
      'INVALID_JSON',
      diagnostics.map((issue) => issue.code + ':' + (issue.path || '/')),
      diagnostics,
    );
  let model;
  try {
    model = JSON.parse(text);
  } catch {
    throw new ArchitectureError('INVALID_JSON');
  }
  return model;
}

/**
 * @param {string} text
 * @param {{ signal?: AbortSignal }} [options]
 */
export function parseArchitecture(text, { signal } = {}) {
  const model = parseJSON(text, { signal });
  signal?.throwIfAborted();
  assertArchitectureLimits(model);
  const result = validateArchitecture(model);
  if (!result.valid)
    throw new ArchitectureError(
      'INVALID_MODEL',
      result.errors,
      result.diagnostics,
    );
  return model;
}
