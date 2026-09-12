import { checkStructure } from './structure.mjs';
import { ArchitectureGraph } from './graph.mjs';
import { ArchitectureError } from './errors.mjs';
import { digest } from './digest.mjs';
import referenceFields from './generated/references.mjs';
import validateChange from './generated/validate-change.mjs';

export { digest } from './digest.mjs';
export const recordReferences = (record) =>
  (referenceFields[record.type] || []).flatMap((field) => {
    const values =
      record[field.name] === undefined ? [] : [].concat(record[field.name]);
    return values.map((key) => ({
      key,
      field: field.name,
      types: field.types,
      history: field.history,
    }));
  });

const definition = ({ basis, reconsideredBecause, ...record }) => record;
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

const index = (model) => new Map(model.records.map((r) => [r.key, r]));
const descendants = (records, key, relation = 'parent') => {
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

export function applicableRequirements(model, key) {
  const records = index(model),
    item = records.get(key);
  if (!item) return [];
  const targets = descendants(records, key);
  let scope = item.type === 'scope' ? item.key : item.scope;
  while (scope) {
    targets.add(scope);
    scope = records.get(scope)?.parent;
  }
  let parent = item.parent;
  while (parent) {
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

export function projectArchitecture(model) {
  const records = index(model);
  const components = model.records.filter((r) => r.type === 'component');
  function node(record) {
    const children = components
      .filter((r) => r.parent === record.key)
      .map(node);
    return {
      key: record.key,
      title: record.title,
      summary: record.summary,
      kind: record.kind,
      zone: record.zone,
      rules: [],
      implemented: false,
      ...(children.length
        ? { detail: 'mapped', children }
        : { detail: 'boundary', detailNote: record.boundary }),
    };
  }
  return {
    version: 3,
    title: model.title,
    scope: 'target',
    entry: model.entry,
    nodes: components.filter((r) => !r.parent).map(node),
    relations: model.records
      .filter((r) => r.type === 'interaction')
      .map((r) => {
        const contract = records.get(r.contract);
        return {
          key: r.key,
          from: r.from,
          to: r.to,
          kind: r.kind,
          channel: r.channel,
          label: r.title,
          payload: contract.payload,
          meaning: contract.meaning,
          implemented: false,
        };
      }),
  };
}

export function validateProject(model) {
  const diagnostics = checkStructure(model);
  const issue = (code, subject, path = '/records') =>
    diagnostics.push({ code, subject, path });
  const finish = () => ({
    valid: !diagnostics.length,
    errors: diagnostics.map((d) => d.code + ':' + (d.subject || d.path)),
    diagnostics,
  });
  if (diagnostics.length) return finish();
  if (model.version !== 4) {
    issue('PROJECT_VERSION', '', '/version');
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
    }
  }
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

export function analyzeProject(model, { verifiedResults = [] } = {}) {
  assertProject(model);
  const records = index(model),
    contract = contractDigest(model),
    realization = realizationDigest(model);
  const verified = new Set(verifiedResults),
    freshness = {},
    completion = {};
  const checks = model.records.filter((r) => r.type === 'check'),
    results = model.records.filter((r) => r.type === 'result');
  const historicalFailures = model.history
    .map((h) => h.record)
    .filter(
      (r) => r.type === 'result' && r.outcome === 'fail' && !records.has(r.key),
    );
  for (const record of model.records) {
    const reasons = [];
    if ('basis' in record) {
      if (!record.basis)
        reasons.push({ code: 'BASIS_MISSING', key: record.key });
      else if (record.basis.contract !== contract)
        reasons.push({ code: 'BASIS_CHANGED', key: record.key });
    }
    if (record.type === 'result' && record.realization !== realization)
      reasons.push({ code: 'REALIZATION_CHANGED', key: record.key });
    freshness[record.key] = { current: !reasons.length, reasons };
  }
  // Propagate actual prerequisite gaps. Scope/containment links are not proof dependencies.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of model.records) {
      if (!freshness[record.key].current) continue;
      const dependencies = recordReferences(record).filter((r) =>
        [
          'uses',
          'sources',
          'needs',
          'check',
          'requirement',
          'covers',
          'scenarios',
          'then',
          'constraints',
        ].includes(r.field),
      );
      const stale = dependencies.find(
        (ref) => freshness[ref.key] && !freshness[ref.key].current,
      );
      if (stale) {
        freshness[record.key] = {
          current: false,
          reasons: [{ code: 'DEPENDENCY_CHANGED', key: stale.key }],
        };
        changed = true;
      }
    }
  }
  const checkReasons = (check) => {
    const reasons = [...freshness[check.key].reasons];
    const current = [...results, ...historicalFailures].filter(
      (r) =>
        r.check === check.key &&
        r.basis?.contract === contract &&
        r.realization === realization,
    );
    const resolved = new Set(
      current
        .filter((r) => r.outcome === 'pass' && verified.has(r.key))
        .flatMap((r) => r.resolves),
    );
    for (const r of current)
      if (r.outcome === 'fail' && !resolved.has(r.key))
        reasons.push({ code: 'CHECK_FAILED', key: r.key });
    if (!current.some((r) => r.outcome === 'pass' && verified.has(r.key)))
      reasons.push({ code: 'EVIDENCE_MISSING', key: check.key });
    return reasons;
  };
  for (const check of checks)
    completion[check.key] = {
      implemented: false,
      reasons: checkReasons(check),
    };
  const criteria = model.records.filter((r) => r.type === 'criterion');
  for (const criterion of criteria) {
    const covers = checks.filter((c) => c.covers.includes(criterion.key));
    const reasons = [
      ...freshness[criterion.key].reasons,
      ...covers.flatMap((c) => completion[c.key].reasons),
    ];
    if (!covers.length)
      reasons.push({ code: 'CHECK_MISSING', key: criterion.key });
    completion[criterion.key] = { implemented: !reasons.length, reasons };
  }
  for (const record of model.records) {
    if (completion[record.key]) continue;
    let selected = [];
    if (record.type === 'requirement')
      selected = criteria.filter((c) => c.requirement === record.key);
    if (record.type === 'task')
      selected = criteria.filter((c) => record.covers.includes(c.key));
    if (record.type === 'scenario')
      selected = criteria.filter((c) => record.then.includes(c.key));
    if (
      ['component', 'scope', 'interaction', 'interface'].includes(record.type)
    ) {
      const requirements = new Set(
        applicableRequirements(model, record.key).map((r) => r.key),
      );
      selected = criteria.filter((c) => requirements.has(c.requirement));
    }
    const reasons = [...freshness[record.key].reasons];
    if (
      record.type === 'interface' &&
      !model.records.some(
        (r) => r.type === 'interaction' && r.contract === record.key,
      )
    )
      reasons.push({ code: 'INTERFACE_UNUSED', key: record.key });
    if (
      record.type === 'scenario' &&
      !checks.some(
        (check) =>
          check.scenarios.includes(record.key) &&
          !completion[check.key].reasons.length,
      )
    )
      reasons.push({ code: 'SCENARIO_UNCHECKED', key: record.key });
    if (
      record.type === 'requirement' &&
      !record.appliesTo.some((key) =>
        ['component', 'interaction', 'interface'].includes(
          records.get(key)?.type,
        ),
      ) &&
      !model.records.some(
        (r) =>
          r.type === 'task' &&
          r.covers.some((key) => selected.some((c) => c.key === key)),
      )
    )
      reasons.push({ code: 'REQUIREMENT_UNMAPPED', key: record.key });
    if (
      [
        'scope',
        'component',
        'interaction',
        'interface',
        'requirement',
        'task',
        'scenario',
      ].includes(record.type)
    ) {
      if (!selected.length)
        reasons.push({ code: 'CRITERIA_MISSING', key: record.key });
      reasons.push(...selected.flatMap((c) => completion[c.key].reasons));
      if (['scope', 'component'].includes(record.type)) {
        const integrated = checks.filter(
          (c) =>
            c.level === 'integration' &&
            c.targets.includes(record.key) &&
            selected.every((a) => c.covers.includes(a.key)),
        );
        if (!integrated.some((c) => !completion[c.key].reasons.length))
          reasons.push({ code: 'INTEGRATION_MISSING', key: record.key });
      }
    }
    if (record.type === 'result' && !verified.has(record.key))
      reasons.push({ code: 'EVIDENCE_UNAVAILABLE', key: record.key });
    if (record.type === 'result' && record.outcome !== 'pass')
      reasons.push({ code: 'CHECK_FAILED', key: record.key });
    completion[record.key] = { implemented: !reasons.length, reasons };
  }
  const uncertain = model.records.filter(
    (r) => r.type === 'source' && ['assumption', 'question'].includes(r.origin),
  );
  let pending = true;
  while (pending) {
    pending = false;
    for (const task of model.records.filter(
      (record) => record.type === 'task',
    )) {
      const item = completion[task.key];
      for (const key of task.needs)
        if (
          completion[key].reasons.length &&
          !item.reasons.some(
            (reason) =>
              reason.code === 'PREREQUISITE_UNCONFIRMED' && reason.key === key,
          )
        ) {
          item.reasons.push({ code: 'PREREQUISITE_UNCONFIRMED', key });
          pending = true;
        }
    }
  }
  // Full implementation is conservative over the whole declared project until dependency coverage is proven.
  const globalGaps = model.records
    .filter((r) =>
      [
        'scope',
        'component',
        'interaction',
        'interface',
        'requirement',
        'decision',
        'task',
        'scenario',
      ].includes(r.type),
    )
    .flatMap((r) => completion[r.key].reasons);
  if (!model.records.some((r) => r.type === 'component'))
    globalGaps.push({ code: 'ARCHITECTURE_MISSING', key: model.root });
  if (!Object.keys(model.bindings).length)
    globalGaps.push({ code: 'REALIZATION_UNAVAILABLE', key: model.root });
  globalGaps.push(
    ...uncertain.map((r) => ({ code: 'UNRESOLVED_SOURCE', key: r.key })),
  );
  for (const record of model.records) {
    const item = completion[record.key];
    if (
      ['component', 'scope', 'interaction', 'interface'].includes(record.type)
    )
      item.reasons.push(...globalGaps);
    item.reasons = [
      ...new Map(item.reasons.map((r) => [r.code + ':' + r.key, r])).values(),
    ];
    item.implemented = !item.reasons.length;
  }
  return { contract, realization, freshness, completion };
}

export function projectContext(model, keys) {
  assertProject(model);
  const records = index(model),
    selected = new Set(keys),
    queue = [...keys];
  for (const key of keys)
    if (!records.has(key)) throw new ArchitectureError('UNKNOWN_RECORD', [key]);
  const include = (key) => {
    if (!selected.has(key) && records.has(key)) {
      selected.add(key);
      queue.push(key);
    }
  };
  for (const key of keys) {
    const record = records.get(key),
      contained = descendants(records, key);
    if (record.type === 'scope')
      for (const other of model.records)
        if (contained.has(other.scope) || contained.has(other.key))
          include(other.key);
    if (record.type === 'component')
      for (const child of contained) include(child);
  }
  for (const key of keys)
    for (const requirement of applicableRequirements(model, key))
      include(requirement.key);
  while (queue.length) {
    const key = queue.pop(),
      record = records.get(key);
    for (const ref of recordReferences(record)) include(ref.key);
    for (const other of model.records) {
      if (other.type === 'criterion' && other.requirement === key)
        include(other.key);
      if (other.type === 'interaction' && [other.from, other.to].includes(key))
        include(other.key);
      if (
        ['decision', 'check', 'task'].includes(other.type) &&
        recordReferences(other).some(
          (ref) => ref.key === key && !['scope', 'needs'].includes(ref.field),
        )
      )
        include(other.key);
    }
  }
  const chosen = model.records.filter((r) => selected.has(r.key));
  return {
    snapshot: digest(model),
    contract: contractDigest(model),
    keys: [...keys],
    reads: Object.fromEntries(chosen.map((r) => [r.key, digest(r)])),
    records: structuredClone(chosen),
    omitted: model.records.length - chosen.length,
  };
}

export function applyProjectChanges(model, context, change) {
  assertProject(model);
  const diagnostics = checkStructure(change, validateChange);
  if (diagnostics.length)
    throw new ArchitectureError('INVALID_CHANGE', [], diagnostics);
  const { put = [], remove = [], review = [], reason } = change;
  // A read receipt cannot silently lose an item or change its bytes.
  if (
    !context ||
    context.snapshot !== digest(model) ||
    context.contract !== contractDigest(model)
  )
    throw new ArchitectureError('CONTEXT_CHANGED');
  const expected = projectContext(model, context.keys);
  if (digest(expected) !== digest(context))
    throw new ArchitectureError('CONTEXT_CHANGED');
  const next = structuredClone(model),
    records = index(next);
  const manifest = {
    title: model.title,
    root: model.root,
    entry: model.entry,
    contract: contractDigest(model),
    realization: realizationDigest(model),
    records: Object.fromEntries(model.records.map((r) => [r.key, digest(r)])),
    bindings: structuredClone(model.bindings),
  };
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
    if (old && !context.reads[old.key])
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
      !context.reads[key]
    )
      throw new ArchitectureError('REVIEW_REQUIRED', [key]);
    archive(record);
    record.basis = { contract: contractDigest(next) };
    record.reconsideredBecause = reason;
  }
  return assertProject(next);
}
