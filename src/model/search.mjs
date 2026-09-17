import { projectArchitecture } from './project-architecture.mjs';

// Finding a part by name is a model question, not a header one. Both accepted
// contracts reduce to the same rendering projection - the tree of parts the map
// draws - so this reads that projection instead of a version-specific field and
// answers a documentation model and a rendering model in the same terms.

/**
 * @typedef {object} Part
 * @property {string} key the part's key, the address the map moves to
 * @property {string} title the part's name as the model states it
 * @property {string} type the part's kind in the rendering vocabulary
 * @property {string} zone the part's responsibility zone
 */

/**
 * @typedef {Part & {rank: 'key' | 'title-prefix' | 'title' | 'facet'}}
 *   SearchMatch a part and the reason it matched
 */

// The stated order. An earlier reason outranks a later one, and parts matching
// for the same reason keep the order of the projection (a depth-first walk of
// the tree), because `sort` is stable.
const ranks = /** @type {const} */ (['key', 'title-prefix', 'title', 'facet']);

/**
 * @param {any} model a v4 documentation model or a v3 rendering model
 * @returns {Part[]} every part of the projection, in projection order
 */
function parts(model) {
  const rendering = model?.version === 4 ? projectArchitecture(model) : model;
  /** @type {Part[]} */
  const found = [];
  /** @param {any} node */
  const walk = (node) => {
    found.push({
      key: String(node.key ?? ''),
      title: String(node.title ?? ''),
      type: String(node.kind ?? ''),
      zone: String(node.zone ?? ''),
    });
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of rendering?.nodes ?? []) walk(node);
  return found;
}

/**
 * Search the parts of a model by key, name, kind and zone. Matching is
 * case-insensitive and the query is trimmed; a blank query and a query that
 * matches nothing both return an empty list rather than throwing, so the caller
 * states the empty result itself.
 *
 * @param {any} model a v4 documentation model or a v3 rendering model
 * @param {string} query what the reader typed
 * @returns {SearchMatch[]} matches, best reason first
 */
export function searchArchitecture(model, query) {
  const needle = String(query ?? '')
    .trim()
    .toLocaleLowerCase();
  if (!needle) return [];
  /** @type {SearchMatch[]} */
  const matches = [];
  for (const part of parts(model)) {
    const title = part.title.toLocaleLowerCase();
    const rank =
      part.key.toLocaleLowerCase() === needle
        ? 'key'
        : title.startsWith(needle)
          ? 'title-prefix'
          : title.includes(needle)
            ? 'title'
            : [part.type, part.zone].some((facet) =>
                  facet.toLocaleLowerCase().includes(needle),
                )
              ? 'facet'
              : null;
    if (rank) matches.push({ ...part, rank });
  }
  return matches.sort((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank));
}
