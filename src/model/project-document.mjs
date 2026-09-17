import { digest } from './digest.mjs';
import {
  nodeAppearance,
  relationAppearance,
  zoneTones,
} from './appearance.mjs';
import { analyzeProject } from './project-analysis.mjs';
import { projectArchitecture } from './project-architecture.mjs';
import { assertProject } from './project-contract.mjs';
import { recordReferences } from './records.mjs';

import {
  renderDocument,
  generatedNotice,
  escape,
  inline,
} from './documents.mjs';

// The diagram is generated from the same projection the map renders, so the
// picture cannot disagree with the UI or with the model behind it, and its zones,
// kinds and relations are named by the same appearance table the map reads. Only
// the tones are shared: this markdown is rendered on a light and on a dark page,
// so every fill and every text colour is left to the reader's theme, and a tone
// is spent on strokes alone.
export function architectureDiagram(model) {
  const architecture = projectArchitecture(model);
  if (!architecture.nodes.length) return [];
  const label = (value) => '"' + String(value).replaceAll('"', '#quot;') + '"';
  // Record keys are free text, so a key like "graph" or "end" would be read as
  // Mermaid syntax. Identifiers are namespaced to keep every key usable.
  const id = (key) => 'c-' + key;
  const zones = new Set();
  const styles = [];
  // Mermaid spells a shape in brackets; the table names it, this maps the name.
  const shaped = {
    box: (text) => '[' + text + ']',
    cylinder: (text) => '[(' + text + ')]',
    stadium: (text) => '([' + text + '])',
  };
  const node = (entry, depth) => {
    const pad = '    '.repeat(depth + 1);
    const look = nodeAppearance(entry);
    const children = entry.children || [];
    if (!children.length) {
      zones.add(entry.zone);
      if (!Object.hasOwn(shaped, look.shape))
        throw new Error('No Mermaid shape for ' + look.shape);
      return [
        pad +
          id(entry.key) +
          shaped[look.shape](label(entry.title)) +
          ':::' +
          entry.zone,
      ];
    }
    // A subgraph takes no class, so its zone is stated as a style line; a
    // grouping node keeps the container shape Mermaid gives it.
    styles.push('    style ' + id(entry.key) + ' stroke:' + look.tone);
    return [
      pad + 'subgraph ' + id(entry.key) + '[' + label(entry.title) + ']',
      ...children.flatMap((child) => node(child, depth + 1)),
      pad + 'end',
    ];
  };
  const nodes = architecture.nodes.flatMap((root) => node(root, 0));
  // The label rides in the pipe form, which every line style accepts.
  const lines = { solid: '-->', thick: '==>', dotted: '-.->' };
  // A kind reads as a line and as a tone. Mermaid tones an edge by its position
  // in the diagram, which is the order the relations are written in below.
  const toned = new Map();
  architecture.relations.forEach((relation, index) => {
    const { tone } = relationAppearance(relation);
    if (!toned.has(tone)) toned.set(tone, []);
    toned.get(tone).push(index);
  });
  return [
    '```mermaid',
    // GitHub scales one wide SVG down until its labels are unreadable, and a
    // left-to-right chain keeps the containers stacked instead of side by side.
    'flowchart LR',
    ...nodes,
    ...architecture.relations.map(
      (r) =>
        '    ' +
        id(r.from) +
        ' ' +
        lines[relationAppearance(r).line] +
        '|' +
        label(r.label) +
        '|' +
        ' ' +
        id(r.to),
    ),
    ...styles,
    ...[...toned].map(
      ([tone, indexes]) =>
        '    linkStyle ' + indexes.join(',') + ' stroke:' + tone,
    ),
    ...[...zones].map(
      (zone) => '    classDef ' + zone + ' stroke:' + zoneTones[zone],
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
