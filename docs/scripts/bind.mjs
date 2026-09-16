import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes } from '../../src/model/digest.mjs';
import { projectContext } from '../../src/model/project-authoring.mjs';
import { updateProjectFile } from '../../src/node.mjs';
import { root, input } from './framework.mjs';

// The file that carries each described part of this repository. A binding is a
// claim about bytes, so the digests are read from disk and never hand-written;
// this table is the only thing an agent maintains when a part moves.
export const files = {
  archivarius: 'package.json',
  model: 'assets/model.schema.json',
  core: 'src/core.mjs',
  graph: 'src/model/graph.mjs',
  digest: 'src/model/digest.mjs',
  'node-api': 'src/node.mjs',
  cli: 'src/cli.mjs',
  evidence: 'src/model/evidence.mjs',
  render: 'src/index.jsx',
  map: 'src/ui/ArchitectureMap.jsx',
  inspector: 'src/ui/ProjectInspector.jsx',
  'model-source': 'src/ui/load.mjs',
  'change-input': 'src/model/project-authoring.mjs',
  'evidence-artifact': 'src/model/evidence.mjs',
  'reference-set': 'src/model/records.mjs',
  'basis-value': 'src/model/project-digest.mjs',
  'record-detail': 'src/model/project-view.mjs',
  'load-model': 'src/ui/load.mjs',
  'check-references': 'src/model/project-contract.mjs',
  'compute-basis': 'src/model/project-digest.mjs',
  'inspect-record': 'src/index.jsx',
  'apply-change': 'src/node.mjs',
  'verify-evidence': 'src/node.mjs',
};

const bound = ['scope', 'component', 'interaction', 'interface'];

export async function collectBindings(model) {
  const described = model.records
    .filter((record) => bound.includes(record.type))
    .map((record) => record.key);
  const stray = Object.keys(files).filter((key) => !described.includes(key));
  if (stray.length) throw new Error('Bound keys left the model: ' + stray);
  const missing = described.filter((key) => !files[key]);
  if (missing.length) throw new Error('Parts without a file: ' + missing);
  return Object.fromEntries(
    await Promise.all(
      described.sort().map(async (key) => [
        key,
        {
          path: files[key],
          digest: hashBytes(
            new Uint8Array(await readFile(path.join(root, files[key]))),
          ),
        },
      ]),
    ),
  );
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const model = JSON.parse(await readFile(input, 'utf8'));
  const bindings = await collectBindings(model);
  if (JSON.stringify(model.bindings) === JSON.stringify(bindings))
    process.exit(0);
  if (process.argv.includes('--check'))
    throw new Error('Bindings are stale: run npm run docs:bind');
  await updateProjectFile(input, projectContext(model, []), { bindings });
}
