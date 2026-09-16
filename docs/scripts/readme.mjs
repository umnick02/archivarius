import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { architectureDiagram } from '../../src/model/project-document.mjs';
import { generatedNotice } from '../../src/model/documents.mjs';
import { analyzeProject } from '../../src/model/project-analysis.mjs';
import { projectArchitecture } from '../../src/model/project-architecture.mjs';
import { assertProject } from '../../src/model/project-contract.mjs';
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

const table = (copy, type, entries, extra = []) => {
  if (!entries.length) return [];
  // A column nobody filled says nothing, so it is dropped rather than shipped
  // empty; which columns exist therefore follows from the records at hand.
  const fields = prose[type].filter((field) =>
    entries.some(([, record]) => value(record, field)),
  );
  return [
    row([
      copy.types[type],
      ...fields.map((field) => copy.fields[field.name]),
      ...extra.map((column) => column.heading),
    ]),
    row(['---', ...fields.map(() => '---'), ...extra.map(() => '---')]),
    ...entries.map(([title, record]) =>
      row([
        title,
        ...fields.map((field) => value(record, field)),
        ...extra.map((column) => column.of(record)),
      ]),
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
