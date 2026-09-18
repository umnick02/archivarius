import { digest } from './digest.mjs';
import { definition, index } from './records.mjs';
import { reviewSelection } from './project-selection.mjs';
import {
  contractDigest,
  dependencyDigest,
  movedDefinitions,
  realizationDigest,
  snapshotManifest,
} from './project-digest.mjs';

/**
 * One record named the way a reader needs it before opening it.
 *
 * @typedef {{ key: string, type: string, title: string }} DiffRecord
 */

/**
 * A record that lost its basis: the code that says how it lost it, and the
 * definitions in its own dependency closure that moved.
 *
 * @typedef {DiffRecord & { code: string, moved: string[] }} ReadingEntry
 */

/**
 * @typedef {{
 *   before: { snapshot: string, contract: string, realization: string },
 *   after: { snapshot: string, contract: string, realization: string },
 *   added: DiffRecord[],
 *   removed: DiffRecord[],
 *   changed: Array<DiffRecord & { fields: string[] }>,
 *   moved: string[],
 *   readingList: ReadingEntry[],
 * }} ProjectDiff
 */

// A basis is the digest set a record was written against, so this is the single
// question the whole report rests on: does that set still describe the model?
// `project-analysis.mjs` asks it too, and asks it here.
export function basisReason(model, record, contract = contractDigest(model)) {
  if (!('basis' in record)) return null;
  if (!record.basis) return { code: 'BASIS_MISSING', key: record.key };
  const definitions = movedDefinitions(model, record);
  if (definitions)
    return definitions.length
      ? { code: 'BASIS_CHANGED', key: record.key, moved: definitions }
      : null;
  const moved =
    record.type !== 'result' && record.basis.dependencies
      ? record.basis.dependencies !== dependencyDigest(model, record.key)
      : record.basis.contract !== contract;
  return moved ? { code: 'BASIS_CHANGED', key: record.key } : null;
}

// A stored manifest names an exact set of revisions rather than a version label,
// so the model it described is rebuilt from the immutable history plus whatever
// revision is still current — the same reconstruction an authored change makes.
export function restoreSnapshot(model, manifest) {
  const revisions = new Map([
    ...model.history.map((h) => [h.digest, h.record]),
    ...model.records.map((r) => [digest(r), r]),
  ]);
  const { contract, realization, records, ...metadata } = manifest;
  return {
    ...model,
    ...metadata,
    records: Object.entries(records).map(([key, hash]) => {
      const record = revisions.get(hash);
      if (!record)
        // Reported to the owner of errors.mjs; a plain code carries it until then.
        throw Object.assign(new Error('SNAPSHOT_INCOMPLETE'), {
          code: 'SNAPSHOT_INCOMPLETE',
          issues: [key],
        });
      return structuredClone(record);
    }),
  };
}

const summary = (record) => ({
  key: record.key,
  type: record.type,
  title: record.title,
});

// Identity is the record key and content is the definition, exactly as digests and
// receipts already read them, so accepting a record again is never a change to it.
function movedFields(before, after) {
  const from = definition(before),
    to = definition(after);
  return [...new Set([...Object.keys(from), ...Object.keys(to)])]
    .filter(
      (field) => digest(from[field] ?? null) !== digest(to[field] ?? null),
    )
    .sort();
}

// The append-only history is the record of every definition that ever moved, so a
// report over a single snapshot can still name what a stale basis was written
// against instead of only saying that something, somewhere, changed.
function editedRecords(model) {
  const present = index(model),
    moved = new Set();
  for (const { record } of model.history) {
    const current = present.get(record.key);
    if (!current || digest(definition(current)) !== digest(definition(record)))
      moved.add(record.key);
  }
  return moved;
}

/**
 * What moved between two snapshots, and what lost its basis as a result.
 *
 * `against` is the earlier side: another model, or one of `model`'s own stored
 * manifests. Left out, it is the most recently stored manifest — the model read
 * against itself, which is the freshness report.
 *
 * @param {any} model the snapshot being reported on
 * @param {any} [against] the earlier snapshot or one of its stored manifests
 * @returns {ProjectDiff}
 */
export function diffProject(model, against = null) {
  const before = !against
    ? model.snapshots.length
      ? restoreSnapshot(model, model.snapshots.at(-1))
      : model
    : Array.isArray(against.records)
      ? against
      : restoreSnapshot(model, against);
  const past = index(before),
    present = index(model),
    byKey = (a, b) => a.key.localeCompare(b.key);
  const added = model.records
    .filter((r) => !past.has(r.key))
    .map(summary)
    .sort(byKey);
  const removed = before.records
    .filter((r) => !present.has(r.key))
    .map(summary)
    .sort(byKey);
  const changed = model.records
    .flatMap((record) => {
      const old = past.get(record.key);
      if (!old) return [];
      const fields = movedFields(old, record);
      return fields.length ? [{ ...summary(record), fields }] : [];
    })
    .sort(byKey);
  const moved = new Set(
    [...added, ...removed, ...changed].map((r) => r.key).sort(),
  );
  // The definitions this diff moved, plus the ones the history already records as
  // edited, so a record that went stale before this pair still names its cause.
  const known = new Set([...moved, ...editedRecords(model)]);
  const closures = new Map();
  const closure = (key) => {
    if (!closures.has(key)) {
      const keys = new Set(
        reviewSelection(model, [key]).records.map((r) => r.key),
      );
      if (past.has(key))
        for (const record of reviewSelection(before, [key]).records)
          keys.add(record.key);
      closures.set(key, keys);
    }
    return closures.get(key);
  };
  const contract = contractDigest(model);
  const lost = model.records.flatMap((record) => {
    const reason = basisReason(model, record, contract);
    return reason ? [{ record, reason }] : [];
  });
  const stale = new Set(lost.map(({ record }) => record.key));
  // A reading list is worked through, so a record is placed after everything on
  // the list it rests on: fewest stale prerequisites first, then by key.
  const ordered = lost
    .map(({ record, reason }) => {
      const keys = closure(record.key);
      return {
        rests: [...keys].filter((key) => key !== record.key && stale.has(key))
          .length,
        entry: {
          ...summary(record),
          code: reason.code,
          moved: [...keys].filter((key) => known.has(key)).sort(),
        },
      };
    })
    .sort((a, b) => a.rests - b.rests || byKey(a.entry, b.entry));
  const side = (snapshot) => ({
    snapshot: digest(snapshotManifest(snapshot)),
    contract: contractDigest(snapshot),
    realization: realizationDigest(snapshot),
  });
  return {
    before: side(before),
    after: side(model),
    added,
    removed,
    changed,
    moved: [...moved],
    readingList: ordered.map(({ entry }) => entry),
  };
}
