import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { architectureDiagram } from '../../src/model/project-document.mjs';
import { generatedNotice } from '../../src/model/documents.mjs';
import { assertProject, projectArchitecture } from '../../src/model/project.mjs';
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

const table = (copy, type, entries) => {
  if (!entries.length) return [];
  const fields = prose[type];
  return [
    row([copy.types[type], ...fields.map((field) => copy.fields[field.name])]),
    row(['---', ...fields.map(() => '---')]),
    ...entries.map(([title, record]) =>
      row([title, ...fields.map((field) => value(record, field))]),
    ),
    '',
  ];
};

export function renderReadme(model, copy) {
  assertProject(model);
  const records = (type) => model.records.filter((r) => r.type === type);
  const scope = records('scope')[0];
  const architecture = projectArchitecture(model);
  const leaves = [];
  const walk = (node) => {
    if (node.children?.length) for (const child of node.children) walk(child);
    else leaves.push(node);
  };
  for (const node of architecture.nodes) walk(node);
  const find = (key) => model.records.find((r) => r.key === key);
  const statements = (record) =>
    prose[record.type].flatMap((field) =>
      value(record, field) ? [value(record, field), ''] : [],
    );
  return [
    '# ' + scope.title,
    '',
    ...statements(scope),
    ...architectureDiagram(model),
    ...records('source').flatMap(statements),
    ...table(
      copy,
      'component',
      leaves.map((node) => [node.title, find(node.key)]),
    ),
    ...table(
      copy,
      'interface',
      architecture.relations.map((relation) => [relation.label, relation]),
    ),
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
