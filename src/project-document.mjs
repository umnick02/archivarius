import {
  assertProject,
  analyzeProject,
  recordReferences,
  digest,
} from './project.mjs';

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!|~\-])/g, '\\$1');
const inline = (value) => escape(value).replace(/[\r\n]+/g, ' ');

export function renderProjectDocumentation(model, copy) {
  assertProject(model);
  const analysis = analyzeProject(model),
    records = new Map(model.records.map((r) => [r.key, r]));
  const link = (key) =>
    '[' + inline(records.get(key)?.title || key) + '](#record-' + key + ')';
  const lines = [
    '# ' + inline(model.title),
    '',
    copy.basisNote,
    '',
    copy.snapshot + ': `' + digest(model) + '`',
    '',
  ];
  for (const record of model.records) {
    lines.push(
      '<a id="record-' + record.key + '"></a>',
      '',
      '## ' + inline(record.title),
      '',
      copy.types[record.type],
      '',
    );
    const refs = recordReferences(record);
    for (const [key, value] of Object.entries(record)) {
      if (
        ['key', 'type', 'title'].includes(key) ||
        (Array.isArray(value) && !value.length)
      )
        continue;
      lines.push('**' + inline(copy.fields[key] || key) + ':**', '');
      const links = refs.filter((ref) => ref.field === key);
      if (links.length)
        lines.push(
          ...links.map(
            (ref) =>
              '- ' + (records.has(ref.key) ? link(ref.key) : inline(ref.key)),
          ),
        );
      else if (Array.isArray(value))
        lines.push(
          ...value.map(
            (part) =>
              '- ' +
              escape(typeof part === 'object' ? JSON.stringify(part) : part),
          ),
        );
      else if (value && typeof value === 'object')
        lines.push(
          ...Object.entries(value).map(
            ([name, part]) => '- ' + inline(name) + ': ' + escape(part),
          ),
        );
      else lines.push(escape(value));
      lines.push('');
    }
    const reasons = analysis.freshness[record.key].reasons;
    if (reasons.length)
      lines.push(
        '**' + copy.reasons + ':**',
        '',
        ...reasons.map(
          (r) =>
            '- ' +
            escape(copy.reasonsByCode[r.code] || r.code) +
            ': ' +
            link(r.key),
        ),
        '',
      );
  }
  if (model.history.length) {
    lines.push('## ' + copy.history, '', copy.historical, '');
    for (const item of model.history)
      lines.push(
        '### ' + inline(item.record.title),
        '',
        escape(JSON.stringify(item.record)),
        '',
      );
  }
  return lines.join('\n');
}
