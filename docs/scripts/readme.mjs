import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { architectureDiagram } from '../../src/model/project-document.mjs';
import { generatedNotice } from '../../src/model/documents.mjs';
import { assertProject, projectArchitecture } from '../../src/model/project.mjs';
import prose from '../../src/generated/prose.mjs';
import { root, input } from './framework.mjs';

// The schema decides which fields are prose; this view decides which records are
// worth a landing page. Field names never appear here, so a field added to the
// schema reaches the readme, the map and an authoring prompt at once.
const statements = (record, type = record?.type) =>
  record
    ? prose[type].flatMap((field) => {
        const value = record[field.name];
        if (value === undefined || value === null) return [];
        return field.many ? value : [value];
      })
    : [];

// A cell keeps each statement on its own line and never lets a value break the
// row it sits in.
const cell = (values) =>
  values.map((v) => String(v).replaceAll('|', '\\|')).join('<br>');

const table = (rows) =>
  rows.length ? ['| | |', '| --- | --- |', ...rows, ''] : [];

export function renderReadme(model) {
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
  return [
    '# ' + scope.title,
    '',
    ...statements(scope).flatMap((line) => [line, '']),
    ...architectureDiagram(model),
    ...records('source').flatMap((source) => [...statements(source), '']),
    ...table(
      leaves.map(
        (node) =>
          '| ' + node.title + ' | ' + cell(statements(find(node.key))) + ' |',
      ),
    ),
    ...table(
      architecture.relations.map(
        (relation) =>
          '| ' +
          relation.label +
          ' | ' +
          cell(statements(relation, 'interface')) +
          ' |',
      ),
    ),
    generatedNotice,
    '',
  ].join('\n');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const model = JSON.parse(await readFile(input, 'utf8'));
  const readme = renderReadme(model);
  const output = path.join(root, 'README.md');
  if (process.argv.includes('--check')) {
    const current = await readFile(output, 'utf8').catch(() => '');
    if (current !== readme)
      throw new Error('README.md is stale: run npm run docs:readme');
  } else await writeFile(output, readme);
}
