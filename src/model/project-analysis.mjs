import {
  applicableRequirements,
  descendants,
  index,
  recordReferences,
} from './records.mjs';
import { assertProject } from './project-contract.mjs';
import { contractDigest, realizationDigest } from './project-digest.mjs';
import { basisReason } from './project-diff.mjs';

// Fields that carry an actual prerequisite. Scope and containment links say where a
// record sits, so they are deliberately absent: they are not proof dependencies.
const prerequisiteFields = [
  'uses',
  'sources',
  'needs',
  'check',
  'requirement',
  'covers',
  'scenarios',
  'then',
  'constraints',
];

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
    const reasons = [],
      basis = basisReason(model, record, contract);
    if (basis) reasons.push(basis);
    if (record.type === 'result' && record.realization !== realization)
      reasons.push({ code: 'REALIZATION_CHANGED', key: record.key });
    freshness[record.key] = { current: !reasons.length, reasons };
  }
  // Propagate actual prerequisite gaps.
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of model.records) {
      if (!freshness[record.key].current) continue;
      const dependencies = recordReferences(record).filter((r) =>
        prerequisiteFields.includes(r.field),
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
      if (!model.bindings[key])
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
