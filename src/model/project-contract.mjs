import { validateDocuments } from './documents.mjs';
import { checkStructure } from './structure.mjs';
import { ArchitectureGraph } from './graph.mjs';
import { ArchitectureError, explainDiagnostics } from './errors.mjs';
import { digest } from './digest.mjs';
import { index, recordReferences } from './records.mjs';
import { projectArchitecture } from './project-architecture.mjs';
import {
  contractDigest,
  definitionBasis,
  dependencyDigest,
  realizationDigest,
} from './project-digest.mjs';

export function validateProject(model) {
  const diagnostics = checkStructure(model);
  const issue = (code, subject, path = '/records') =>
    diagnostics.push({ code, subject, path });
  const finish = () => {
    const explained = explainDiagnostics(diagnostics, model);
    return {
      valid: !explained.length,
      errors: explained.map((d) => d.code + ':' + (d.subject || d.path)),
      diagnostics: explained,
    };
  };
  if (diagnostics.length) return finish();
  if (model.version !== 4) {
    issue('PROJECT_VERSION', '', '/version');
    return finish();
  }
  if (model.archive) {
    issue('ARCHIVE_NOT_LOADED', '', '/archive');
    return finish();
  }
  const records = index(model),
    archived = new Map();
  for (const [i, item] of model.history.entries()) {
    if (digest(item.record) !== item.digest)
      issue('HISTORY_DIGEST', item.record.key, '/history/' + i);
    if (archived.has(item.digest))
      issue('DUPLICATE_REVISION', item.record.key, '/history/' + i);
    archived.set(item.digest, item.record);
  }
  const historical = (key) => [...archived.values()].find((r) => r.key === key);
  const revisions = new Map([
    ...archived,
    ...model.records.map((r) => [digest(r), r]),
  ]);
  const snapshots = new Map();
  for (const [i, snapshot] of model.snapshots.entries()) {
    const selected = Object.entries(snapshot.records).map(([key, revision]) => {
      const record = revisions.get(revision);
      if (!record || record.key !== key)
        issue('SNAPSHOT_REFERENCE', key, '/snapshots/' + i);
      return record;
    });
    if (selected.every(Boolean)) {
      // A stored manifest is an exact set of definitions, not a version label.
      const projected = { ...model, ...snapshot, records: selected };
      if (
        snapshot.contract !== contractDigest(projected) ||
        snapshot.realization !== realizationDigest(projected)
      )
        issue('SNAPSHOT_DIGEST', '', '/snapshots/' + i);
      else snapshots.set(snapshot.contract, projected);
    }
  }
  validateDocuments(model, issue);
  const seen = new Set(),
    topics = new Set();
  for (const [i, record] of model.records.entries()) {
    const path = '/records/' + i;
    if (seen.has(record.key))
      issue('DUPLICATE_RECORD', record.key, path + '/key');
    seen.add(record.key);
    const previous = historical(record.key);
    if (previous && previous.type !== record.type)
      issue('IDENTITY_TYPE', record.key, path + '/type');
    for (const ref of recordReferences(record)) {
      const target =
        records.get(ref.key) || (ref.history && historical(ref.key));
      if (!target) issue('MISSING_REFERENCE', ref.key, path + '/' + ref.field);
      else if (!ref.types.includes(target.type))
        issue('REFERENCE_TYPE', ref.key, path + '/' + ref.field);
      if (ref.key === record.key)
        issue('SELF_REFERENCE', record.key, path + '/' + ref.field);
    }
    if (record.type === 'scope' && record.key !== model.root && !record.parent)
      issue('SCOPE_ROOT', record.key, path);
    if (record.type === 'decision') {
      const topic = record.scope + ':' + record.topic;
      if (topics.has(topic))
        issue('DECISION_CONFLICT', record.key, path + '/topic');
      topics.add(topic);
      if (record.supersedes && records.has(record.supersedes))
        issue('SUPERSEDED_CURRENT', record.key, path + '/supersedes');
    }
    if (record.type === 'result') {
      if (
        [...archived.values()].some(
          (old) => old.key === record.key && digest(old) !== digest(record),
        )
      )
        issue('RESULT_IMMUTABLE', record.key, path);
      if (!record.basis) issue('RESULT_BASIS', record.key, path + '/basis');
      if (record.resolves.length && !record.resolution)
        issue('RESOLUTION_REQUIRED', record.key, path);
      for (const key of record.resolves) {
        const old = records.get(key) || historical(key);
        if (old && (old.check !== record.check || old.outcome !== 'fail'))
          issue('INVALID_RESOLUTION', record.key, path + '/resolves');
      }
    }
  }
  if (
    records.get(model.root)?.type !== 'scope' ||
    records.get(model.root)?.parent
  )
    issue('SCOPE_ROOT', model.root, '/root');
  const hasArchitecture = model.records.some(
    (record) => record.type === 'component',
  );
  if (
    hasArchitecture
      ? records.get(model.entry)?.type !== 'component'
      : model.entry !== null
  )
    issue('ENTRY_REQUIRED', model.entry, '/entry');
  const cycle = (refs, code) => {
    const active = new Set(),
      done = new Set();
    function visit(key) {
      if (active.has(key)) {
        issue(code, key);
        return;
      }
      if (done.has(key)) return;
      active.add(key);
      for (const next of refs(records.get(key)))
        if (records.has(next)) visit(next);
      active.delete(key);
      done.add(key);
    }
    for (const key of records.keys()) visit(key);
  };
  cycle((r) => (r.parent ? [r.parent] : []), 'CONTAINMENT_CYCLE');
  cycle((r) => (r.type === 'task' ? r.needs : []), 'TASK_CYCLE');
  cycle(
    (r) =>
      r.type === 'decision'
        ? r.uses
        : r.type === 'requirement'
          ? r.sources
          : [],
    'BASIS_CYCLE',
  );
  cycle((r) => (r.type === 'result' ? r.resolves : []), 'RESULT_CYCLE');
  if (diagnostics.length) return finish();
  for (const record of model.records) {
    if (record.type === 'component') {
      const children = model.records.filter((r) => r.parent === record.key);
      if (!children.length && !record.boundary)
        issue('BOUNDARY_REQUIRED', record.key);
      if (children.length && (record.kind !== 'subsystem' || record.boundary))
        issue('COMPONENT_DETAIL', record.key);
    }
  }
  if (!diagnostics.length && hasArchitecture) {
    const graph = ArchitectureGraph.validate(projectArchitecture(model));
    diagnostics.push(...graph.diagnostics);
  }
  if (!diagnostics.length) {
    snapshots.set(contractDigest(model), model);
    for (const record of model.records) {
      if (record.type === 'result') continue;
      const scoped = record.basis?.definitions;
      if (!scoped && !record.basis?.dependencies) continue;
      const source = snapshots.get(record.basis.contract);
      if (!source || !source.records.some((r) => r.key === record.key)) {
        issue('BASIS_SNAPSHOT_MISSING', record.key);
        continue;
      }
      try {
        if (
          record.basis.dependencies &&
          dependencyDigest(source, record.key) !== record.basis.dependencies
        )
          issue('BASIS_DEPENDENCIES_MISMATCH', record.key);
        // A receipt naming its definitions one by one is held to each of them:
        // the snapshot it points at has to read back the same set of digests.
        if (
          scoped &&
          digest(definitionBasis(source, record.key)) !== digest(scoped)
        )
          issue('BASIS_DEFINITIONS_MISMATCH', record.key);
      } catch {
        issue('BASIS_SOURCE_INVALID', record.key);
      }
    }
  }
  return finish();
}

export function assertProject(model) {
  const result = validateProject(model);
  if (!result.valid)
    throw new ArchitectureError(
      'INVALID_MODEL',
      result.errors,
      result.diagnostics,
    );
  return model;
}
