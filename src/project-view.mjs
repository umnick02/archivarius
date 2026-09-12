import { applicableRequirements, recordReferences } from './project.mjs';

export const primaryFields = {
  document: ['stage', 'path'],
  scope: ['purpose'],
  source: ['statement', 'origin'],
  component: ['summary'],
  requirement: ['rule', 'parameters', 'when', 'exceptions'],
  criterion: ['assertion', 'requirement'],
  decision: ['choice', 'because', 'consequences'],
  interface: ['payload', 'meaning', 'constraints'],
  interaction: ['from', 'to', 'contract'],
  scenario: ['actor', 'given', 'steps', 'then', 'failures'],
  task: ['change', 'affects', 'covers', 'needs'],
  check: ['method', 'covers', 'scenarios', 'targets'],
  result: ['outcome', 'check', 'resolution', 'resolves'],
};
export const technicalFields = new Set([
  'basis',
  'realization',
  'evidence',
  'reconsideredBecause',
]);
export const viewTypes = {
  architecture: ['scope', 'component'],
  rules: ['requirement', 'criterion', 'decision', 'scenario', 'source'],
  work: ['task'],
  confirmation: ['check', 'result'],
  documents: ['document'],
};
export const currentRecord = (project, key) =>
  project.records.find((r) => r.key === key) ||
  project.history.findLast((h) => h.record.key === key)?.record;

export function recordSummary(record) {
  return (
    (primaryFields[record.type] || [])
      .map((field) => record[field])
      .find((value) => typeof value === 'string') || ''
  );
}

export function searchEntries(project, record, copy) {
  const refs = recordReferences(record);
  const flatten = (value, path) => {
    if (Array.isArray(value)) return value.flatMap((v) => flatten(v, path));
    if (value && typeof value === 'object')
      return Object.entries(value).flatMap(([k, v]) =>
        flatten(v, [...path, k]),
      );
    return [{ field: path.join(' · '), text: String(value ?? '') }];
  };
  return Object.entries(record).flatMap(([field, value]) => {
    if (field === 'key' || technicalFields.has(field)) return [];
    const links = refs.filter((r) => r.field === field);
    const content = links.length
      ? links.map((r) => currentRecord(project, r.key)?.title || r.key)
      : field === 'type'
        ? copy.types[value]
        : typeof value === 'string' &&
            ['origin', 'kind', 'zone', 'level', 'outcome'].includes(field)
          ? copy.values[value] || value
          : value;
    return flatten(content, [
      copy.fields[field] || (field === 'title' ? copy.title : field),
    ]);
  });
}

export function searchRecord(project, record, query, copy) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { field: '', text: recordSummary(record) };
  const match = searchEntries(project, record, copy).find((entry) =>
    `${entry.field} ${entry.text}`.toLocaleLowerCase().includes(needle),
  );
  if (!match) return undefined;
  const at = match.text.toLocaleLowerCase().indexOf(needle);
  const start = Math.max(0, at - 60);
  const end = Math.min(
    match.text.length,
    Math.max(start + 180, at + needle.length),
  );
  return {
    ...match,
    snippet:
      (start ? '…' : '') +
      match.text.slice(start, end) +
      (end < match.text.length ? '…' : ''),
  };
}

export function relatedGroups(project, key) {
  const direct = project.records.filter(
    (r) =>
      r.key !== key &&
      recordReferences(r).some(
        (ref) => ref.key === key && ref.field !== 'scope',
      ),
  );
  const requirements = applicableRequirements(project, key).filter(
    (r) => r.key !== key,
  );
  const groups = new Map();
  for (const r of new Map(
    [...requirements, ...direct].map((r) => [r.key, r]),
  ).values()) {
    if (!groups.has(r.type)) groups.set(r.type, []);
    groups.get(r.type).push(r);
  }
  return groups;
}

// Keep every reported cause. Group its affected records by architectural area;
// a shared contract can affect more than one area, without changing the verdict.
export function confirmationGroups(project, reasons) {
  const records = new Map(project.records.map((r) => [r.key, r]));
  const rootOf = (key) => {
    let r = records.get(key);
    while (r?.parent) r = records.get(r.parent);
    return r?.key || project.root;
  };
  const areas = (record, seen = new Set()) => {
    if (!record || seen.has(record.key)) return [];
    seen = new Set([...seen, record.key]);
    if (record.type === 'component' || record.type === 'scope')
      return [rootOf(record.key)];
    const targets =
      record.type === 'interaction'
        ? [record.from, record.to]
        : record.type === 'interface'
          ? project.records
              .filter(
                (r) => r.type === 'interaction' && r.contract === record.key,
              )
              .map((r) => r.key)
          : record.type === 'requirement'
            ? record.appliesTo
            : record.type === 'criterion'
              ? [record.requirement]
              : record.affects || record.targets || [];
    const result = targets.flatMap((key) => areas(records.get(key), seen));
    return result.length
      ? [...new Set(result)]
      : [record.scope || project.root];
  };
  const groups = new Map();
  for (const reason of reasons) {
    if (!groups.has(reason.code))
      groups.set(reason.code, {
        code: reason.code,
        keys: new Set(),
        areas: new Map(),
      });
    const group = groups.get(reason.code);
    group.keys.add(reason.key);
    for (const area of areas(currentRecord(project, reason.key))) {
      if (!group.areas.has(area)) group.areas.set(area, new Set());
      group.areas.get(area).add(reason.key);
    }
  }
  return [...groups.values()];
}
