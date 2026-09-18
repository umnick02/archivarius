import { digest } from './digest.mjs';
import { definition } from './records.mjs';
import { reviewSelection } from './project-selection.mjs';

// What a record claims, with the label it is filed under and the receipt that
// accepted it left out: a rename or a re-review is not a change to the claim.
const claim = ({ title, basis, reconsideredBecause, ...record }) => record;

// A section set read as one definition, so an owning document moves a record's
// basis only when the prose that covers it moves, not when it is repositioned.
const sections = (document) => ({
  path: document.path,
  blocks: document.sections.map((s) => s.block),
});

// The contract is what the project promises: its shape and its definitions, with
// results left out because evidence reports on a contract instead of forming it.
export function contractDigest(model) {
  return digest({
    version: model.version,
    title: model.title,
    root: model.root,
    entry: model.entry,
    records: model.records
      .filter((r) => r.type !== 'result')
      .map(definition)
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  });
}

export const realizationDigest = (model) => digest(model.bindings);

// What a single record was reviewed against: its own dependency closure, so an
// unrelated edit elsewhere in the project leaves its review standing.
export function dependencyDigest(model, key) {
  const selection = reviewSelection(model, [key]);
  return digest({
    version: model.version,
    root: model.root,
    entry: model.entry,
    records: selection.records
      .filter((r) => r.type !== 'result')
      .map(claim)
      .sort((a, b) => a.key.localeCompare(b.key)),
    // Position changes alone do not change an owning section's meaning.
    documents: selection.documents
      .map((d) => ({ key: d.key, ...sections(d) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
}

/**
 * The same closure named definition by definition instead of hashed into one
 * digest. One digest answers a single question — did anything in the closure
 * move — so any edit withdraws every claim that shares the snapshot. Naming each
 * definition keeps the question per definition, so a change withdraws the records
 * that rested on it and leaves the rest standing.
 *
 * @param {any} model
 * @param {string} key the record whose basis is being read
 * @returns {Record<string, string>} one digest per definition, keyed by record
 */
export function definitionBasis(model, key) {
  const selection = reviewSelection(model, [key]);
  return Object.fromEntries(
    [
      ...selection.records
        .filter((r) => r.type !== 'result')
        .map((r) => [r.key, digest(claim(r))]),
      ...selection.documents.map((d) => [d.key, digest(sections(d))]),
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  );
}

/**
 * Which of the definitions a record rested on have moved since it was written.
 * `null` when the record records no per-definition basis at all — there is
 * nothing scoped to compare, so nothing scoped is withdrawn.
 *
 * @param {any} model
 * @param {any} record
 * @returns {string[] | null}
 */
export function movedDefinitions(model, record) {
  const recorded = record?.basis?.definitions;
  if (!recorded || typeof recorded !== 'object') return null;
  // A removed run still answers for a failure in history. Read its check against
  // today's definitions without requiring the receipt to be a current record.
  const current = model.records.some((r) => r.key === record.key)
    ? model
    : { ...model, records: [...model.records, record] };
  const now = definitionBasis(current, record.key);
  return [...new Set([...Object.keys(recorded), ...Object.keys(now)])]
    .filter((key) => recorded[key] !== now[key])
    .sort();
}

// An exact set of revisions rather than a version label, so a stored snapshot can
// be rebuilt into the model it described.
export const snapshotManifest = (model) => ({
  title: model.title,
  root: model.root,
  entry: model.entry,
  contract: contractDigest(model),
  realization: realizationDigest(model),
  records: Object.fromEntries(model.records.map((r) => [r.key, digest(r)])),
  bindings: structuredClone(model.bindings),
});
