import { digest } from './digest.mjs';
import { definition } from './records.mjs';
import { reviewSelection } from './project-selection.mjs';

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
  const semantic = ({ title, basis, reconsideredBecause, ...record }) => record;
  return digest({
    version: model.version,
    root: model.root,
    entry: model.entry,
    records: selection.records
      .filter((r) => r.type !== 'result')
      .map(semantic)
      .sort((a, b) => a.key.localeCompare(b.key)),
    // Position changes alone do not change an owning section's meaning.
    documents: selection.documents
      .map((d) => ({
        key: d.key,
        path: d.path,
        blocks: d.sections.map((s) => s.block),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
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
