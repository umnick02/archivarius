import {
  assertProject,
  analyzeProject,
  recordReferences,
  digest,
} from './project.mjs';

import { renderDocument } from './documents.mjs';

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!|~-])/g, '\\$1');
const inline = (value) => escape(value).replace(/[\r\n]+/g, ' ');

// The diagram is generated from the component and interaction records so that it
// cannot drift from the model: no second hand-drawn copy of the architecture.
function architectureDiagram(model) {
  const components = model.records.filter((r) => r.type === 'component');
  if (!components.length) return [];
  const label = (value) => '"' + String(value).replaceAll('"', '#quot;') + '"';
  const node = (component, depth) => {
    const pad = '    '.repeat(depth + 1);
    const children = components.filter((r) => r.parent === component.key);
    if (!children.length)
      return [pad + component.key + '[' + label(component.title) + ']'];
    return [
      pad + 'subgraph ' + component.key + '[' + label(component.title) + ']',
      ...children.flatMap((child) => node(child, depth + 1)),
      pad + 'end',
    ];
  };
  const roots = components.filter(
    (r) => !components.some((other) => other.key === r.parent),
  );
  return [
    '```mermaid',
    'flowchart TD',
    ...roots.flatMap((root) => node(root, 0)),
    ...model.records
      .filter((r) => r.type === 'interaction')
      .map((r) => '    ' + r.from + ' -->|' + label(r.channel) + '| ' + r.to),
    '```',
    '',
  ];
}

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
    ...architectureDiagram(model),
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
    if (record.type === 'document') {
      const content = renderDocument(model, record, {
        notice: false,
        headingOffset: 2,
      });
      lines.push(
        record.format === 'json' ? '```json\n' + content + '```' : content,
        '',
      );
      continue;
    }
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
