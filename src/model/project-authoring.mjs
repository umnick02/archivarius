import { documentReferences, documentSections } from './documents.mjs';
import { checkStructure } from './structure.mjs';
import {
  ArchitectureError,
  explainDiagnostics,
  staleContextDiagnostics,
} from './errors.mjs';
import { digest } from './digest.mjs';
import {
  applicableRequirements,
  definition,
  descendants,
  index,
  membershipFields,
  recordReferences,
} from './records.mjs';
import { reviewSelection } from './project-selection.mjs';
import {
  contractDigest,
  dependencyDigest,
  snapshotManifest,
} from './project-digest.mjs';
import { assertProject } from './project-contract.mjs';
import validateChange from '../generated/validate-change.mjs';

export function projectRead(model, keys) {
  assertProject(model);
  const selected = reviewSelection(model, keys);
  return {
    keys: [...keys],
    records: selected.records.map(definition),
    documents: selected.documents,
    omitted: model.records.length - selected.records.length,
  };
}

export function projectContext(model, keys) {
  assertProject(model);
  return collectProjectContext(model, keys);
}

// A receipt of what an author was shown, so a later change can prove it was based
// on the current model rather than a stale or trimmed read.
function collectProjectContext(model, keys) {
  const records = index(model),
    selected = new Set(),
    expanded = new Set(),
    queue = [];
  const include = (key, expand = true) => {
    if (!records.has(key)) return;
    selected.add(key);
    if (expand && !expanded.has(key)) {
      expanded.add(key);
      queue.push(key);
    }
  };
  for (const key of keys) {
    const record = records.get(key);
    if (!record) throw new ArchitectureError('UNKNOWN_RECORD', [key]);
    include(key);
    if (record.type === 'scope') {
      const scopes = descendants(records, key);
      for (const other of model.records)
        if (scopes.has(other.scope) || scopes.has(other.key))
          include(other.key);
    }
    if (record.type === 'component') {
      for (const child of descendants(records, key)) include(child);
      for (const other of model.records)
        if (
          ['task', 'decision'].includes(other.type) &&
          other.affects.some((target) => descendants(records, key).has(target))
        )
          include(other.key);
    }
  }
  while (queue.length) {
    const key = queue.pop(),
      record = records.get(key);
    for (const ref of recordReferences(record))
      include(ref.key, !membershipFields.has(ref.field));
    if (
      ['component', 'interface', 'interaction', 'task'].includes(record.type)
    ) {
      const targets = record.type === 'task' ? record.affects : [key];
      for (const target of targets)
        for (const requirement of applicableRequirements(model, target))
          include(requirement.key);
    }
    for (const other of model.records) {
      if (other.type === 'criterion' && other.requirement === key)
        include(other.key);
      if (
        other.type === 'interaction' &&
        record.type === 'component' &&
        [other.from, other.to].includes(key)
      )
        include(other.key);
      if (
        other.type === 'check' &&
        (other.covers.includes(key) || other.scenarios.includes(key))
      )
        include(other.key);
      if (other.type === 'result' && other.check === key) include(other.key);
    }
  }
  for (const key of keys)
    for (const record of reviewSelection(model, [key]).records)
      include(record.key, false);
  const sectionKeys = new Set(selected);
  const documents = model.records
    .filter((record) => record.type === 'document')
    .flatMap((document) => {
      const sections = documentSections(document, sectionKeys);
      if (!sections.length) return [];
      for (const { block } of sections)
        for (const ref of documentReferences({ blocks: [block] }))
          include(ref.record, false);
      return [
        {
          key: document.key,
          path: document.path,
          digest: digest(document),
          sections,
        },
      ];
    });
  const chosen = model.records.filter((record) => selected.has(record.key));
  return {
    snapshot: digest(snapshotManifest(model)),
    contract: contractDigest(model),
    keys: [...keys],
    reads: Object.fromEntries(
      chosen.map((record) => [record.key, digest(record)]),
    ),
    records: structuredClone(chosen),
    documents: structuredClone(documents),
    omitted: model.records.length - chosen.length,
  };
}

export function applyProjectChanges(model, context, change) {
  assertProject(model);
  const diagnostics = checkStructure(change, validateChange);
  if (diagnostics.length)
    throw new ArchitectureError(
      'INVALID_CHANGE',
      [],
      explainDiagnostics(diagnostics, change),
    );
  const { put = [], remove = [], review = [], reason } = change;
  // A stale receipt says which read moved, so the author reads that record again
  // instead of the whole closure. Taking the read may itself fail on a key the
  // model dropped, and that is still a receipt that moved.
  const asRead = (keys) => {
    try {
      return collectProjectContext(model, keys);
    } catch {
      return null;
    }
  };
  const stale = (current) =>
    new ArchitectureError(
      'CONTEXT_CHANGED',
      [],
      staleContextDiagnostics(context, current),
    );
  // Reconstruct the original receipt from immutable revisions, then compare the
  // current read closure. Disjoint edits may rebase; trimmed or stale reads may not.
  if (!context || !Array.isArray(context.keys)) throw stale(null);
  const manifest = snapshotManifest(model);
  let basis = model;
  if (context.snapshot !== digest(manifest)) {
    const saved = model.snapshots.find((s) => digest(s) === context.snapshot);
    if (!saved) throw stale(asRead(context.keys));
    const revisions = new Map([
      ...model.history.map((h) => [h.digest, h.record]),
      ...model.records.map((r) => [digest(r), r]),
    ]);
    const { contract, realization, ...metadata } = saved;
    basis = {
      ...model,
      ...metadata,
      history: [...revisions].map(([digest, record]) => ({ digest, record })),
      records: Object.values(saved.records).map((hash) => revisions.get(hash)),
    };
  }
  if (basis !== model) assertProject(basis);
  const expected = collectProjectContext(basis, context.keys);
  if (digest(expected) !== digest(context)) throw stale(asRead(context.keys));
  const current = collectProjectContext(model, context.keys);
  if (
    digest(current.reads) !== digest(context.reads) ||
    digest(current.documents) !== digest(context.documents) ||
    ['title', 'root', 'entry', 'bindings'].some(
      (key) => digest(model[key]) !== digest(basis[key]),
    ) ||
    (context.contract !== current.contract &&
      put.some((r) => r.type === 'result'))
  )
    throw stale(current);
  const next = structuredClone(model),
    records = index(next);
  if (!next.snapshots.some((s) => digest(s) === digest(manifest)))
    next.snapshots.push(manifest);
  const archive = (record) => {
    const hash = digest(record);
    if (!next.history.some((h) => h.digest === hash))
      next.history.push({ digest: hash, record: structuredClone(record) });
  };
  const changedKeys = new Set();
  for (const record of put) {
    if (changedKeys.has(record.key))
      throw new ArchitectureError('DUPLICATE_RECORD', [record.key]);
    changedKeys.add(record.key);
    const old = records.get(record.key);
    if (
      old &&
      Object.keys(collectProjectContext(model, [old.key]).reads).some(
        (key) => !context.reads[key],
      )
    )
      throw new ArchitectureError('CONTEXT_INCOMPLETE', [old.key]);
    if (old?.type === 'result' && digest(old) !== digest(record))
      throw new ArchitectureError('RESULT_IMMUTABLE', [old.key]);
    if (old && old.type !== record.type)
      throw new ArchitectureError('IDENTITY_TYPE', [old.key]);
    if (old && digest(old) !== digest(record)) archive(old);
    if ('basis' in record && record.type !== 'result') {
      if (digest(record.basis) !== digest(old?.basis ?? null))
        throw new ArchitectureError('REVIEW_REQUIRED', [record.key]);
    }
    records.set(record.key, structuredClone(record));
  }
  for (const key of remove) {
    if (changedKeys.has(key) || !records.has(key) || !context.reads[key])
      throw new ArchitectureError('CONTEXT_INCOMPLETE', [key]);
    archive(records.get(key));
    records.delete(key);
  }
  next.records = [...records.values()];
  for (const key of ['title', 'root', 'entry', 'bindings'])
    if (change[key] !== undefined) next[key] = structuredClone(change[key]);
  assertProject(next);
  for (const key of review) {
    const record = records.get(key);
    if (
      !reason?.trim() ||
      !record ||
      !('basis' in record) ||
      record.type === 'result' ||
      !context.reads[key] ||
      Object.keys(collectProjectContext(model, [key]).reads).some(
        (read) => !context.reads[read],
      )
    )
      throw new ArchitectureError('REVIEW_REQUIRED', [key]);
    const selection = reviewSelection(next, [key]);
    if (
      selection.records.some(
        (r) => !context.reads[r.key] && !changedKeys.has(r.key),
      ) ||
      selection.documents.some(
        (d) =>
          !context.reads[d.key] &&
          !changedKeys.has(d.key) &&
          !context.documents.some(
            (read) =>
              read.key === d.key &&
              d.sections.every((section) =>
                read.sections.some((s) => s.index === section.index),
              ),
          ),
      )
    )
      throw new ArchitectureError('REVIEW_REQUIRED', [key]);
    archive(record);
    record.basis = {
      contract: contractDigest(next),
      dependencies: dependencyDigest(next, key),
    };
    record.reconsideredBecause = reason;
  }
  return assertProject(next);
}
