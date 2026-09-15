import {
  documentReferences,
  documentSections,
  validateDocuments,
} from './documents.mjs';
import { checkStructure } from './structure.mjs';
import { ArchitectureGraph } from './graph.mjs';
import { ArchitectureError } from './errors.mjs';
import { digest } from './digest.mjs';
import referenceFields from './generated/references.mjs';
import validateChange from './generated/validate-change.mjs';

export { digest } from './digest.mjs';
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

// Review dependencies follow owned contracts, not reverse implementation/evidence
// consumers. Recompute membership so new inherited constraints also invalidate.
function reviewSelection(model, keys) {
  const records = index(model),
    selected = new Set(),
    expanded = new Set();
  const queue = keys.map((key) => [key, true]);
  const shallow = new Set([
    'scope',
    'parent',
    'appliesTo',
    'affects',
    'targets',
    'from',
    'to',
    'subjects',
  ]);
  while (queue.length) {
    const [key, expand] = queue.pop(),
      record = records.get(key);
    if (!record) throw new ArchitectureError('UNKNOWN_RECORD', [key]);
    selected.add(key);
    if (!expand || expanded.has(key)) continue;
    expanded.add(key);
    for (const ref of recordReferences(record))
      if (!ref.history) queue.push([ref.key, !shallow.has(ref.field)]);
    if (['task', 'check', 'decision'].includes(record.type)) {
      // Explicit covers/uses define local scope; ancestor-scope rules always apply.
      let scope = record.scope;
      while (scope) {
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

const snapshotManifest = (model) => ({
  title: model.title,
  root: model.root,
  entry: model.entry,
  contract: contractDigest(model),
  realization: realizationDigest(model),
  records: Object.fromEntries(model.records.map((r) => [r.key, digest(r)])),
  bindings: structuredClone(model.bindings),
});

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
    completion = {},
    dependencies = new Map(model.records.map((r) => [r.key, new Set()])),
    coverage = new Map(model.records.map((r) => [r.key, new Set()])),
    localReasons = new Map();
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
      else if (
        record.type !== 'result' && record.basis.dependencies
          ? record.basis.dependencies !== dependencyDigest(model, record.key)
          : record.basis.contract !== contract
      )
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
  const criteria = model.records.filter((r) => r.type === 'criterion');
  const depend = (key, keys, covered = false) => {
    for (const target of keys)
      if (records.has(target)) {
        dependencies.get(key).add(target);
        if (covered) coverage.get(key).add(target);
      }
  };
  const targetsFor = (record) => {
    const targets = new Set([record.key]);
    let parent = record.parent;
    while (parent) {
      targets.add(parent);
      parent = records.get(parent).parent;
    }
    let scope = record.scope;
    while (scope) {
      targets.add(scope);
      scope = records.get(scope).parent;
    }
    return targets;
  };
  // Membership and declared obligations define proof dependencies. In particular,
  // an interaction depends on its contract, not on both endpoint implementations.
  // Otherwise the connected architecture would collapse into one global verdict.
  for (const record of model.records) {
    const key = record.key;
    const reasons =
      record.type === 'check'
        ? checkReasons(record)
        : [...freshness[key].reasons];
    localReasons.set(key, reasons);
    if (
      record.type === 'source' &&
      ['assumption', 'question'].includes(record.origin)
    )
      reasons.push({ code: 'UNRESOLVED_SOURCE', key });
    if (record.type === 'requirement') {
      const selected = criteria.filter((c) => c.requirement === key);
      depend(
        key,
        selected.map((c) => c.key),
        true,
      );
      depend(key, [...record.sources, ...(record.guards || [])]);
      if (!selected.length) reasons.push({ code: 'CRITERIA_MISSING', key });
      if (
        !record.appliesTo.some((target) =>
          ['component', 'interaction', 'interface'].includes(
            records.get(target).type,
          ),
        ) &&
        !model.records.some(
          (r) =>
            r.type === 'task' &&
            r.covers.some((target) => selected.some((c) => c.key === target)),
        )
      )
        reasons.push({ code: 'REQUIREMENT_UNMAPPED', key });
    }
    if (record.type === 'criterion') {
      const covers = checks.filter((c) => c.covers.includes(key));
      const unit = covers.filter((c) => c.level === 'unit');
      depend(key, [
        ...(unit.length ? unit : covers).map((c) => c.key),
        ...records.get(record.requirement).sources,
      ]);
      // Unit evidence may establish a criterion before integration runs. An
      // actual unresolved failure from any covering check still contradicts it.
      reasons.push(
        ...covers.flatMap((c) =>
          checkReasons(c).filter((r) => r.code === 'CHECK_FAILED'),
        ),
      );
      if (!covers.length) reasons.push({ code: 'CHECK_MISSING', key });
    }
    if (record.type === 'decision') depend(key, record.uses);
    if (record.type === 'task') {
      depend(key, record.covers, true);
      depend(key, [...record.needs, ...record.uses]);
    }
    if (record.type === 'scenario') {
      depend(key, record.then, true);
      depend(key, record.uses);
      if (
        !checks.some(
          (check) =>
            check.scenarios.includes(key) && !checkReasons(check).length,
        )
      )
        reasons.push({ code: 'SCENARIO_UNCHECKED', key });
    }
    if (
      ['component', 'scope', 'interaction', 'interface'].includes(record.type)
    ) {
      depend(
        key,
        applicableRequirements(model, key).map((r) => r.key),
        true,
      );
      if (!Object.keys(model.bindings).length)
        reasons.push({ code: 'REALIZATION_UNAVAILABLE', key });
    }
    if (record.type === 'interface') {
      depend(key, record.constraints, true);
      if (
        !model.records.some(
          (r) => r.type === 'interaction' && r.contract === key,
        )
      )
        reasons.push({ code: 'INTERFACE_UNUSED', key });
    }
    if (record.type === 'interaction') depend(key, [record.contract], true);
    if (record.type === 'component') {
      const parts = descendants(records, key);
      depend(
        key,
        [...parts].filter((part) => part !== key),
        true,
      );
      depend(
        key,
        model.records
          .filter(
            (r) =>
              r.type === 'interaction' &&
              (parts.has(r.from) || parts.has(r.to)),
          )
          .map((r) => r.key),
        true,
      );
    }
    if (record.type === 'scope') {
      const scopes = descendants(records, key);
      const members = model.records.filter(
        (r) => r.key !== key && (scopes.has(r.scope) || scopes.has(r.key)),
      );
      depend(
        key,
        members
          .filter((r) => !['check', 'result', 'document'].includes(r.type))
          .map((r) => r.key),
        true,
      );
      if (!members.some((r) => r.type === 'component'))
        reasons.push({ code: 'ARCHITECTURE_MISSING', key });
    }
    if (
      [
        'component',
        'scope',
        'interaction',
        'interface',
        'requirement',
      ].includes(record.type)
    ) {
      const targets = targetsFor(record);
      const assigned = model.records.filter(
        (r) =>
          ['decision', 'task'].includes(r.type) &&
          r.affects.some((target) => targets.has(target)),
      );
      for (const item of assigned)
        depend(key, [item.key], item.type === 'task');
    }
    if (record.type === 'result' && !verified.has(record.key))
      reasons.push({ code: 'EVIDENCE_UNAVAILABLE', key: record.key });
    if (record.type === 'result' && record.outcome !== 'pass')
      reasons.push({ code: 'CHECK_FAILED', key: record.key });
  }
  const closure = (links, start) => {
    const found = new Set(),
      queue = [start];
    while (queue.length) {
      const key = queue.pop();
      if (found.has(key)) continue;
      found.add(key);
      queue.push(...links.get(key));
    }
    return found;
  };
  const closures = new Map(
    model.records.map((record) => [
      record.key,
      closure(dependencies, record.key),
    ]),
  );
  for (const record of model.records) {
    // Prerequisite evidence can block completion, but cannot be counted as work
    // completed on this record. Only its declared criteria and parts contribute.
    const selected = [...closure(coverage, record.key)].filter(
      (key) => records.get(key).type === 'criterion',
    );
    const reasons = localReasons.get(record.key);
    if (
      [
        'scope',
        'component',
        'interface',
        'interaction',
        'task',
        'scenario',
      ].includes(record.type) &&
      !selected.length
    )
      reasons.push({ code: 'CRITERIA_MISSING', key: record.key });
    if (
      ['scope', 'component'].includes(record.type) &&
      !checks.some(
        (c) =>
          c.level === 'integration' &&
          c.targets.includes(record.key) &&
          selected.every((key) => c.covers.includes(key)) &&
          !checkReasons(c).length,
      )
    )
      reasons.push({ code: 'INTEGRATION_MISSING', key: record.key });
    completion[record.key] = {
      progress: { criteria: selected.sort(), confirmedCriteria: [] },
    };
  }
  for (const task of model.records.filter((r) => r.type === 'task'))
    for (const key of task.needs)
      if (
        [...closures.get(key)].some(
          (dependency) => localReasons.get(dependency).length,
        )
      )
        localReasons
          .get(task.key)
          .push({ code: 'PREREQUISITE_UNCONFIRMED', key });
  for (const record of model.records) {
    const item = completion[record.key];
    const reasons = [...closures.get(record.key)].flatMap((key) =>
      localReasons.get(key),
    );
    item.reasons = [
      ...new Map(reasons.map((r) => [r.code + ':' + r.key, r])).values(),
    ];
    item.implemented = !item.reasons.length;
  }
  for (const item of Object.values(completion)) {
    item.progress.confirmedCriteria = item.progress.criteria.filter(
      (key) => completion[key].implemented,
    );
    item.state = item.implemented
      ? 'confirmed'
      : item.progress.confirmedCriteria.length
        ? 'partial'
        : 'unconfirmed';
  }
  return { contract, realization, freshness, completion };
}

export function projectContext(model, keys) {
  assertProject(model);
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
  const shallow = new Set([
    'scope',
    'parent',
    'appliesTo',
    'affects',
    'targets',
    'from',
    'to',
    'subjects',
  ]);
  while (queue.length) {
    const key = queue.pop(),
      record = records.get(key);
    for (const ref of recordReferences(record))
      include(ref.key, !shallow.has(ref.field));
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
    throw new ArchitectureError('INVALID_CHANGE', [], diagnostics);
  const { put = [], remove = [], review = [], reason } = change;
  // Reconstruct the original receipt from immutable revisions, then compare the
  // current read closure. Disjoint edits may rebase; trimmed or stale reads may not.
  if (!context || !Array.isArray(context.keys))
    throw new ArchitectureError('CONTEXT_CHANGED');
  const manifest = snapshotManifest(model);
  let basis = model;
  if (context.snapshot !== digest(manifest)) {
    const saved = model.snapshots.find((s) => digest(s) === context.snapshot);
    if (!saved) throw new ArchitectureError('CONTEXT_CHANGED');
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
  const expected = projectContext(basis, context.keys);
  if (digest(expected) !== digest(context))
    throw new ArchitectureError('CONTEXT_CHANGED');
  const current = projectContext(model, context.keys);
  if (
    digest(current.reads) !== digest(context.reads) ||
    digest(current.documents) !== digest(context.documents) ||
    ['title', 'root', 'entry', 'bindings'].some(
      (key) => digest(model[key]) !== digest(basis[key]),
    ) ||
    (context.contract !== current.contract &&
      put.some((r) => r.type === 'result'))
  )
    throw new ArchitectureError('CONTEXT_CHANGED');
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
      Object.keys(projectContext(model, [old.key]).reads).some(
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
      Object.keys(projectContext(model, [key]).reads).some(
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
