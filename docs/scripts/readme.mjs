import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { architectureDiagram } from '../../src/model/project-document.mjs';
import { generatedNotice } from '../../src/model/documents.mjs';
import { analyzeProject } from '../../src/model/project-analysis.mjs';
import { projectArchitecture } from '../../src/model/project-architecture.mjs';
import { assertProject } from '../../src/model/project-contract.mjs';
import { primaryFields } from '../../src/model/project-view.mjs';
import prose from '../../src/generated/prose.mjs';
import { root, input } from './framework.mjs';

// The schema decides which fields are prose, the UI copy decides how they are
// named, and this view decides which records are worth a landing page. Field
// names never appear here, so a field added to the schema reaches the readme,
// the map and an authoring prompt at once - under the label the map shows.
const value = (record, field) => {
  const held = record?.[field.name];
  if (held === undefined || held === null) return '';
  return (field.many ? held : [held])
    .map((line) => String(line).replaceAll('|', '\\|'))
    .join('<br>');
};

const row = (cells) => '| ' + cells.join(' | ') + ' |';

// A column that reads the same down every row carries no more than one line of
// prose would, so it is left out; with a single row there is nothing to compare.
const varies = (entries, cell) =>
  entries.length < 2 || new Set(entries.map(cell)).size > 1;

const table = (copy, type, entries, extra = []) => {
  if (!entries.length) return [];
  // The map already ranks a record's fields to summarize it, and this page is
  // the same summary in a row: the fields it leads with, minus those nobody
  // filled and those that never differ.
  const ranked = primaryFields[type] || [];
  const fields = prose[type]
    .filter((field) => ranked.includes(field.name))
    .sort((a, b) => ranked.indexOf(a.name) - ranked.indexOf(b.name))
    .filter(
      (field) =>
        entries.some(([, record]) => value(record, field)) &&
        varies(entries, ([, record]) => value(record, field)),
    );
  const columns = [
    ...fields.map((field) => ({
      heading: copy.fields[field.name],
      of: (record) => value(record, field),
    })),
    ...extra.filter((column) =>
      varies(entries, ([, record]) => column.of(record)),
    ),
  ];
  return [
    row([copy.types[type], ...columns.map((column) => column.heading)]),
    row(['---', ...columns.map(() => '---')]),
    ...entries.map(([title, record]) =>
      row([title, ...columns.map((column) => column.of(record))]),
    ),
    '',
  ];
};

export function renderReadme(model, copy) {
  assertProject(model);
  const records = (type) => model.records.filter((r) => r.type === type);
  const scope = records('scope')[0];
  const architecture = projectArchitecture(model);
  const parts = [];
  const walk = (node) => {
    parts.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const node of architecture.nodes) walk(node);
  const find = (key) => model.records.find((r) => r.key === key);
  const statements = (record) =>
    prose[record.type].flatMap((field) =>
      value(record, field) ? [value(record, field), ''] : [],
    );
  // A reader learns what is confirmed from the same analysis and the same
  // wording the map shows, including its caveat about what a number means.
  const progress = analyzeProject(model).completion[scope.key];
  const confirmed = new Set(progress.progress.confirmedCriteria);
  // What is missing is stated once per kind of gap; naming every record again
  // would only reprint the model.
  const reasons = [
    ...new Set(
      progress.reasons.map((reason) => copy.reasonsByCode[reason.code]),
    ),
  ].filter(Boolean);
  return [
    '# ' + scope.title,
    '',
    ...statements(scope),
    ...architectureDiagram(model),
    ...records('source').flatMap(statements),
    copy.criteriaProgress
      .replace('{confirmed}', String(confirmed.size))
      .replace('{total}', String(progress.progress.criteria.length)),
    '',
    copy.confirmationNote,
    '',
    ...table(
      copy,
      'component',
      parts.map((node) => [node.title, find(node.key)]),
    ),
    ...table(
      copy,
      'interface',
      architecture.relations.map((relation) => [relation.label, relation]),
    ),
    ...table(
      copy,
      'requirement',
      records('requirement').map((record) => [record.title, record]),
      [
        {
          // A requirement is confirmed when every criterion under it is, which
          // is what the map reports and what a reader wants to know here.
          heading: copy.confirmedCriteria,
          of: (record) => {
            const under = records('criterion').filter(
              (criterion) => criterion.requirement === record.key,
            );
            return under.length && under.every((c) => confirmed.has(c.key))
              ? copy.yes
              : copy.no;
          },
        },
      ],
    ),
    ...table(
      copy,
      'decision',
      records('decision').map((record) => [record.title, record]),
    ),
    ...(reasons.length
      ? [row([copy.reasons]), row(['---']), ...reasons.map((r) => row([r])), '']
      : []),
    generatedNotice,
    '',
  ].join('\n');
}

export async function readCopy() {
  return JSON.parse(
    await readFile(
      new URL('../../assets/project.json', import.meta.url),
      'utf8',
    ),
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const model = JSON.parse(await readFile(input, 'utf8'));
  const readme = renderReadme(model, await readCopy());
  const output = path.join(root, 'README.md');
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current !== readme)
      throw new Error('README.md is stale: run npm run docs:readme');
  } else await writeFile(output, readme);
}
