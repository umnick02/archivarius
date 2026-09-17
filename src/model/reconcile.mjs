import { bindingParts } from './binding.mjs';
import { projectArchitecture } from './project-architecture.mjs';

// A digest proves a file has not moved, not that it still does what a record
// claims, so a description can stay confirmed while the code it describes
// contradicts it. This module reconciles the two: the relations the model
// declares against the dependencies the code has, and it answers in the model's
// own vocabulary — parts and relations, not files.
//
// Three answers, and the third is the point. A declared relation whose
// dependency is gone is absent; a dependency between two described parts that
// nobody declared is undeclared; and everything the reconciliation cannot
// attribute — a relation whose ends no file carries, an edge out of a file no
// part describes — is reported as unjudged or unattributed rather than silently
// counted as agreement.

/**
 * A dependency read out of the code: a repository-relative path that depends on
 * another repository-relative path, or on a bare package specifier.
 *
 * @typedef {{ from: string, to: string }} ObservedEdge
 */

/**
 * A declared relation and the files its two parts are bound to.
 *
 * @typedef {{ relation: string, from: string, to: string, fromPath: string,
 *   toPath: string }} JudgedRelation
 */

/**
 * A declared relation no dependency could be checked for, and why: neither part
 * is bound to a file (`endpoints-unbound`), one of them is not
 * (`source-unbound`, `target-unbound`), or both are bound to the same file, which
 * cannot show a dependency between them (`shared-file`).
 *
 * @typedef {{ relation: string, from: string, to: string,
 *   reason: 'endpoints-unbound' | 'source-unbound' | 'target-unbound'
 *     | 'shared-file' }} UnjudgedRelation
 */

/**
 * A dependency between two described parts that no relation declares.
 *
 * @typedef {{ from: string, to: string, fromPath: string,
 *   toPath: string }} UndeclaredDependency
 */

/**
 * A dependency the contract does not let any record declare, because a relation
 * cannot end on a container. Naming it is the honest answer: asking for a
 * declaration the model may not hold would be a repair nobody can make.
 *
 * @typedef {{ from: string, to: string, fromPath: string, toPath: string,
 *   reason: 'source-is-group' | 'target-is-group' }} UndeclarableDependency
 */

/**
 * A dependency between a part and a part that contains it, either way round.
 * Containment is already stated by the parent, so it is answered apart from a
 * relation nobody declared - reported, never silent.
 *
 * @typedef {{ from: string, to: string, fromPath: string, toPath: string,
 *   reason: 'inside-container' | 'into-contained' }} ContainedDependency
 */

/**
 * An observed dependency the reconciliation could not attribute to described
 * parts, and which end it lost: the report's own blind spot.
 *
 * @typedef {{ from: string, to: string,
 *   reason: 'endpoints-unknown' | 'source-unknown'
 *     | 'target-unknown' }} UnattributedEdge
 */

/**
 * @typedef {{ confirmed: JudgedRelation[], absent: JudgedRelation[],
 *   undeclared: UndeclaredDependency[], contained: ContainedDependency[],
 *   undeclarable: UndeclarableDependency[],
 *   unjudged: UnjudgedRelation[],
 *   unattributed: UnattributedEdge[] }} Reconciliation
 */

/** @param {{ from: string, to: string }} edge @returns {string} */
const pair = (edge) => edge.from + '\u0000' + edge.to;

/** @param {{ from: string, to: string }} a @param {{ from: string, to: string }} b */
const byEnds = (a, b) =>
  a.from < b.from
    ? -1
    : a.from > b.from
      ? 1
      : a.to < b.to
        ? -1
        : a.to > b.to
          ? 1
          : 0;

/**
 * Every component key the projection draws, however deep it is nested.
 *
 * @param {ReturnType<typeof projectArchitecture>['nodes']} nodes
 * @returns {Set<string>}
 */
function drawnParts(nodes) {
  const keys = new Set();
  /** @param {unknown[]} list */
  const walk = (list) => {
    for (const node of list) {
      const entry = /** @type {{ key: string, children?: unknown }} */ (node);
      keys.add(entry.key);
      if (Array.isArray(entry.children)) walk(entry.children);
    }
  };
  walk(nodes);
  return keys;
}

/**
 * Reconcile what the model says about its relations with the dependencies the
 * code really has.
 *
 * The observed edges are direct dependencies. A declared relation holds when the
 * source part's file reaches the target part's file through them without passing
 * through the file of a third described part — a dependency that only travels
 * through another part belongs to that part, not to this relation. An undeclared
 * dependency, by contrast, is only ever reported for a direct edge, and in the
 * direction the code has it: the reverse of a declared relation is undeclared.
 *
 * @param {{ records: Array<Record<string, any>>,
 *   bindings?: Record<string, { path?: string }> }} model a snapshot
 * @param {Iterable<ObservedEdge>} observed the dependencies read from the code
 * @returns {Reconciliation}
 */
export function reconcileArchitecture(model, observed) {
  const { nodes, relations } = projectArchitecture(/** @type {any} */ (model));
  const described = drawnParts(nodes);
  // A relation may not end on a container, so a dependency out of one is reported
  // as undeclarable rather than as a record somebody forgot to write.
  const groups = new Set(
    model.records
      .filter((record) => record.type === 'component' && record.parent)
      .map((record) => record.parent),
  );
  const bindings = model.bindings ?? {};

  // A part may rest on several files, so every file its binding names attributes
  // to it and any of them satisfies a dependency on that part.
  /** @type {Map<string, string[]>} */
  const partsAt = new Map();
  /** @type {Map<string, string[]>} */
  const filesOf = new Map();
  for (const [key, binding] of Object.entries(bindings)) {
    if (!described.has(key) || !binding) continue;
    const paths = bindingParts(/** @type {any} */ (binding))
      .map((part) => part.path)
      .filter((path) => path && path !== 'undefined');
    if (!paths.length) continue;
    filesOf.set(key, paths);
    for (const path of paths) {
      const list = partsAt.get(path);
      if (list) list.push(key);
      else partsAt.set(path, [key]);
    }
  }

  // Who contains whom, so an edge inside a container is not read as a relation
  // across one.
  /** @type {Map<string, string>} */
  const parentOf = new Map(
    model.records
      .filter((record) => record.type === 'component' && record.parent)
      .map((record) => [record.key, record.parent]),
  );
  /** @param {string} key @param {string} other */
  const contains = (key, other) => {
    for (let at = parentOf.get(other); at; at = parentOf.get(at))
      if (at === key) return true;
    return false;
  };
  // The files a described part carries: the reconciliation stops a walk at these,
  // because reaching one is that part's dependency and no longer this one's.
  const carried = new Set(partsAt.keys());
  /** @param {string} key */
  const pathsOf = (key) => (described.has(key) ? filesOf.get(key) : undefined);

  /** @type {Map<string, string[]>} */
  const out = new Map();
  const edges = [...observed];
  for (const edge of edges) {
    const list = out.get(edge.from);
    if (list) list.push(edge.to);
    else out.set(edge.from, [edge.to]);
  }

  /** @param {string[]} from @param {string[]} to @returns {boolean} */
  const reaches = (from, to) => {
    const wanted = new Set(to);
    const seen = new Set(from);
    const queue = [...from];
    while (queue.length) {
      const at = /** @type {string} */ (queue.shift());
      for (const next of out.get(at) ?? []) {
        if (wanted.has(next)) return true;
        if (seen.has(next) || carried.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  };

  const declared = new Set(relations.map(pair));

  /** @type {JudgedRelation[]} */
  const confirmed = [];
  /** @type {JudgedRelation[]} */
  const absent = [];
  /** @type {UnjudgedRelation[]} */
  const unjudged = [];
  for (const relation of relations) {
    const { key, from, to } = relation;
    const fromPaths = pathsOf(from);
    const toPaths = pathsOf(to);
    const reason = !fromPaths
      ? toPaths
        ? 'source-unbound'
        : 'endpoints-unbound'
      : !toPaths
        ? 'target-unbound'
        : fromPaths.every((path) => toPaths.includes(path))
          ? 'shared-file'
          : null;
    if (reason !== null) {
      unjudged.push({ relation: key, from, to, reason });
      continue;
    }
    const judged = {
      relation: key,
      from,
      to,
      fromPath: /** @type {string[]} */ (fromPaths).join(', '),
      toPath: /** @type {string[]} */ (toPaths).join(', '),
    };
    (reaches(
      /** @type {string[]} */ (fromPaths),
      /** @type {string[]} */ (toPaths),
    )
      ? confirmed
      : absent
    ).push(judged);
  }

  /** @type {UndeclaredDependency[]} */
  const undeclared = [];
  /** @type {ContainedDependency[]} */
  const contained = [];
  /** @type {UndeclarableDependency[]} */
  const undeclarable = [];
  /** @type {UnattributedEdge[]} */
  const unattributed = [];
  const already = new Set();
  for (const edge of edges) {
    const sources = partsAt.get(edge.from) ?? [];
    const targets = partsAt.get(edge.to) ?? [];
    if (!sources.length || !targets.length) {
      const reason = !sources.length
        ? targets.length
          ? 'source-unknown'
          : 'endpoints-unknown'
        : 'target-unknown';
      const seen = pair(edge) + reason;
      if (already.has(seen)) continue;
      already.add(seen);
      unattributed.push({ from: edge.from, to: edge.to, reason });
      continue;
    }
    for (const from of sources)
      for (const to of targets) {
        if (from === to || declared.has(pair({ from, to }))) continue;
        const seen = pair({ from, to });
        if (already.has(seen)) continue;
        already.add(seen);
        const containment = contains(to, from)
          ? 'inside-container'
          : contains(from, to)
            ? 'into-contained'
            : null;
        const forbidden = groups.has(from)
          ? 'source-is-group'
          : groups.has(to)
            ? 'target-is-group'
            : null;
        const answer = containment
          ? contained
          : forbidden
            ? undeclarable
            : undeclared;
        answer.push({
          from,
          to,
          fromPath: edge.from,
          toPath: edge.to,
          ...(containment || forbidden
            ? { reason: containment ?? forbidden }
            : {}),
        });
      }
  }

  return {
    confirmed,
    absent,
    undeclared: undeclared.sort(byEnds),
    contained: contained.sort(byEnds),
    undeclarable: undeclarable.sort(byEnds),
    unjudged,
    unattributed: unattributed.sort(byEnds),
  };
}
