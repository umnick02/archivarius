import { digest } from './digest.mjs';
import { analyzeProject } from './project-analysis.mjs';
import { projectArchitecture } from './project-architecture.mjs';
import { assertProject } from './project-contract.mjs';
import { recordReferences } from './records.mjs';

import { renderDocument, generatedNotice } from './documents.mjs';

const escape = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]|~])/g, '\\$1')
    // Only a line that opens with Markdown structure can change the shape of the
    // document; punctuation inside a sentence must stay readable.
    .replace(/^(\s*)([#>+-]|\d+\.)/gm, '$1\\$2');
const inline = (value) => escape(value).replace(/[\r\n]+/g, ' ');

// The diagram is generated from the same projection the map renders, so the
// picture cannot disagree with the UI or with the model behind it.
export function architectureDiagram(model) {
  const architecture = projectArchitecture(model);
  if (!architecture.nodes.length) return [];
  const label = (value) => '"' + String(value).replaceAll('"', '#quot;') + '"';
  // Record keys are free text, so a key like "graph" or "end" would be read as
  // Mermaid syntax. Identifiers are namespaced to keep every key usable.
  const id = (key) => 'c-' + key;
  const node = (entry, depth) => {
    const pad = '    '.repeat(depth + 1);
    const children = entry.children || [];
    if (!children.length)
      return [pad + id(entry.key) + '[' + label(entry.title) + ']'];
    return [
      pad + 'subgraph ' + id(entry.key) + '[' + label(entry.title) + ']',
      ...children.flatMap((child) => node(child, depth + 1)),
      pad + 'end',
    ];
  };
  return [
    '```mermaid',
    'flowchart TD',
    ...architecture.nodes.flatMap((root) => node(root, 0)),
    ...architecture.relations.map(
      (r) => '    ' + id(r.from) + ' -->|' + label(r.label) + '| ' + id(r.to),
    ),
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
        value === null ||
        value === undefined ||
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
  return [...lines, generatedNotice, ''].join('\n');
}
