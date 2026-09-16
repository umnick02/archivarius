import { documentReferences } from './documents.mjs';
import referenceFields from '../generated/references.mjs';

// The schema names every field that points at another record; nothing here
// enumerates a field, so a reference added to the contract is followed at once.
export const recordReferences = (record) => [
  ...(referenceFields[record.type] || []).flatMap((field) => {
    const values =
      record[field.name] === undefined ? [] : [].concat(record[field.name]);
    return values.map((key) => ({
      key,
      field: field.name,
      types: field.types,
      history: field.history,
    }));
  }),
  ...documentReferences(record).map((ref) => ({
    key: ref.record,
    field: ref.path,
    types: Object.keys(referenceFields),
    history: false,
  })),
];

// A definition is what the record claims, without the receipt of the review that
// accepted it. Digests and reads compare definitions so re-reviewing is not a change.
export const definition = ({ basis, reconsideredBecause, ...record }) => record;

export const index = (model) => new Map(model.records.map((r) => [r.key, r]));

export const descendants = (records, key, relation = 'parent') => {
  const found = new Set([key]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of records.values())
      if (!found.has(record.key) && found.has(record[relation])) {
        found.add(record.key);
        changed = true;
      }
  }
  return found;
};

// Membership links say where a record sits, not what it is built on, so a walk
// that follows them stops instead of dragging in the whole neighbourhood.
export const membershipFields = new Set([
  'scope',
  'parent',
  'appliesTo',
  'affects',
  'targets',
  'from',
  'to',
  'subjects',
]);

export function applicableRequirements(model, key) {
  const records = index(model),
    item = records.get(key);
  if (!item) return [];
  const targets = descendants(records, key);
  let scope = item.type === 'scope' ? item.key : item.scope;
  const seenScopes = new Set();
  while (scope && !seenScopes.has(scope)) {
    seenScopes.add(scope);
    targets.add(scope);
    scope = records.get(scope)?.parent;
  }
  let parent = item.parent;
  const seenParents = new Set();
  while (parent && !seenParents.has(parent)) {
    seenParents.add(parent);
    targets.add(parent);
    parent = records.get(parent)?.parent;
  }
  return model.records.filter(
    (r) =>
      r.type === 'requirement' &&
      (r.appliesTo.some((target) => targets.has(target)) ||
        (item.type === 'scope' && descendants(records, key).has(r.scope))),
  );
}
