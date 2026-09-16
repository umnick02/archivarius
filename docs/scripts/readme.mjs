import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { architectureDiagram } from '../../src/project-document.mjs';
import { generatedNotice } from '../../src/documents.mjs';
import { assertProject } from '../../src/project.mjs';
import { root, input } from './framework.mjs';

// A landing page, not a report: the scope states what the project is, the
// diagram carries what the map draws, and the sources state why it exists.
// Every sentence comes from a record, so this file holds structure only.
export function renderReadme(model) {
  assertProject(model);
  const records = (type) => model.records.filter((r) => r.type === type);
  const scope = records('scope')[0];
  return [
    '# ' + scope.title,
    '',
    scope.purpose,
    '',
    ...architectureDiagram(model),
    ...records('source').flatMap((source) => [source.statement, '']),
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
