import { documentSections } from './documents.mjs';
import { ArchitectureError } from './errors.mjs';
import {
  applicableRequirements,
  index,
  membershipFields,
  recordReferences,
} from './records.mjs';

// Review dependencies follow owned contracts, not reverse implementation/evidence
// consumers. Recompute membership so new inherited constraints also invalidate.
export function reviewSelection(model, keys) {
  const records = index(model),
    selected = new Set(),
    expanded = new Set();
  const queue = keys.map((key) => [key, true]);
  while (queue.length) {
    const [key, expand] = queue.pop(),
      record = records.get(key);
    if (!record) throw new ArchitectureError('UNKNOWN_RECORD', [key]);
    selected.add(key);
    if (!expand || expanded.has(key)) continue;
    expanded.add(key);
    for (const ref of recordReferences(record))
      if (!ref.history) queue.push([ref.key, !membershipFields.has(ref.field)]);
    if (['task', 'check', 'decision'].includes(record.type)) {
      // Explicit covers/uses define local scope; ancestor-scope rules always apply.
      let scope = record.scope;
      const seenScopes = new Set();
      while (scope && !seenScopes.has(scope)) {
        seenScopes.add(scope);
        for (const other of model.records)
          if (other.type === 'requirement' && other.appliesTo.includes(scope))
            queue.push([other.key, true]);
        scope = records.get(scope)?.parent;
      }
    }
    if (
      ['component', 'interface', 'interaction', 'scope'].includes(record.type)
    )
      for (const requirement of applicableRequirements(model, key))
        queue.push([requirement.key, true]);
    if (keys.includes(key) && record.type === 'requirement')
      for (const other of model.records)
        if (other.type === 'criterion' && other.requirement === key)
          queue.push([other.key, true]);
  }
  const documents = model.records
    .filter((r) => r.type === 'document' && !selected.has(r.key))
    .flatMap((document) => {
      const sections = documentSections(document, selected);
      return sections.length
        ? [{ key: document.key, path: document.path, sections }]
        : [];
    });
  return {
    records: model.records.filter((r) => selected.has(r.key)),
    documents,
  };
}
