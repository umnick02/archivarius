import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hashBytes, canonical } from '../../src/model/digest.mjs';
import { bindingParts, partDigest } from '../../src/model/binding.mjs';
import { projectContext } from '../../src/model/project-authoring.mjs';
import { updateProjectFile } from '../../src/node.mjs';
import { root, input } from './framework.mjs';

// The file that carries each described part of this repository. A binding is a
// claim about bytes, so the digests are read from disk and never hand-written;
// this table is the only thing an agent maintains when a part moves. A string is
// the whole of one file; a list states the several files - and, with `from`/`to`,
// the lines - a description actually rests on, so an edit elsewhere does not ask
// for a reading it does not need.
export const files = {
  archivarius: 'package.json',
  model: 'assets/archivarius-model.schema.json',
  // The core is what it claims: the parse and validation surface, the projection
  // the map draws and the freshness and completion analysis - republished by
  // src/core.mjs, carried by these files.
  core: [
    { path: 'src/core.mjs' },
    { path: 'src/model/parse.mjs' },
    { path: 'src/model/project-contract.mjs' },
    { path: 'src/model/project-architecture.mjs' },
    { path: 'src/model/project-analysis.mjs' },
  ],
  graph: 'src/model/graph.mjs',
  digest: 'src/model/digest.mjs',
  'node-api': 'src/node.mjs',
  cli: 'src/cli.mjs',
  evidence: 'src/model/evidence.mjs',
  render: 'src/index.jsx',
  // The map is not one file: the mount, the surface that draws it, a card, an
  // edge, the chrome around it and the geometry it derives all carry it. A part
  // that claims one file of several is a binding that lets the rest change
  // unread, so each file the map rests on is named.
  map: [
    { path: 'src/ui/ArchitectureMap.jsx' },
    { path: 'src/ui/App.jsx' },
    { path: 'src/ui/ArchitectureNode.jsx' },
    { path: 'src/ui/ArchitectureEdge.jsx' },
    { path: 'src/ui/MapChrome.jsx' },
    { path: 'src/ui/MapHeader.jsx' },
    { path: 'src/ui/MapOverlays.jsx' },
    { path: 'src/ui/Overview.jsx' },
    { path: 'src/ui/Filters.jsx' },
    { path: 'src/ui/useMapProjection.jsx' },
  ],
  inspector: [
    { path: 'src/ui/ProjectInspector.jsx' },
    { path: 'src/ui/Inspector.jsx' },
    { path: 'src/ui/NodePanel.jsx' },
    { path: 'src/ui/RelationPanel.jsx' },
    { path: 'src/ui/Reach.jsx' },
    { path: 'src/ui/Interactions.jsx' },
    { path: 'src/ui/ProjectOverview.jsx' },
    { path: 'src/ui/ProjectDocument.jsx' },
    { path: 'src/ui/usePanelNavigation.jsx' },
  ],
  'model-source': 'src/ui/load.mjs',
  'hash-evidence': 'src/model/evidence.mjs',
  'validate-before-verify': 'src/model/evidence.mjs',
  'hash-record': 'src/ui/ProjectInspector.jsx',
  'change-input': 'src/model/project-authoring.mjs',
  'evidence-artifact': 'src/model/evidence.mjs',
  'reference-set': 'src/model/records.mjs',
  'basis-value': 'src/model/project-digest.mjs',
  'record-detail': 'src/model/project-view.mjs',
  'load-model': 'src/ui/load.mjs',
  'check-references': 'src/model/project-contract.mjs',
  'compute-basis': 'src/model/project-digest.mjs',
  'inspect-record': 'src/index.jsx',
  'node-index': 'src/model/graph.mjs',
  'index-nodes': 'src/ui/useMapProjection.jsx',
  'single-relation-bundle': 'src/model/graph.mjs',
  'single-relation-facts': 'src/ui/Interactions.jsx',
  'apply-change': 'src/node.mjs',
  'verify-evidence': 'src/node.mjs',
};

const bound = ['scope', 'component', 'interaction', 'interface'];

// The described parts and the file the table gives each of them. A part without a
// file, or a bound key nothing describes, is a broken map of the repository and
// fails at once; nothing here reads bytes.
export function boundPaths(model) {
  const described = model.records
    .filter((record) => bound.includes(record.type))
    .map((record) => record.key);
  const stray = Object.keys(files).filter((key) => !described.includes(key));
  if (stray.length) throw new Error('Bound keys left the model: ' + stray);
  const missing = described.filter((key) => !files[key]);
  if (missing.length) throw new Error('Parts without a file: ' + missing);
  return Object.fromEntries(described.sort().map((key) => [key, files[key]]));
}

const bytesOf = async (file) =>
  new Uint8Array(await readFile(path.join(root, file)));

export async function collectBindings(model) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(boundPaths(model)).map(async ([key, entry]) => [
        key,
        typeof entry === 'string'
          ? { path: entry, digest: hashBytes(await bytesOf(entry)) }
          : {
              parts: await Promise.all(
                entry.map(async (part) => ({
                  ...part,
                  digest: partDigest(await bytesOf(part.path), part),
                })),
              ),
            },
      ]),
    ),
  );
}

// The parts whose file no longer holds the bytes the last release recorded. This
// is a reading list, not a verdict: each named part is a description an agent has
// to read against its file again.
export function staleParts(model, bindings) {
  return Object.keys(bindings)
    .filter((key) => {
      const released = model.bindings?.[key];
      // The whole claim is compared, not just its digest: a part that gained a
      // file or narrowed a range is a description to read again.
      return !released || canonical(released) !== canonical(bindings[key]);
    })
    .sort();
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const model = JSON.parse(await readFile(input, 'utf8'));
  if (process.argv.includes('--check')) {
    const paths = boundPaths(model);
    const spelled = (entry) =>
      typeof entry === 'string' ? [entry] : entry.map((part) => part.path);
    const recorded = Object.fromEntries(
      Object.entries(model.bindings ?? {}).map(([key, binding]) => [
        key,
        bindingParts(binding).map((part) => part.path),
      ]),
    );
    const wanted = Object.fromEntries(
      Object.entries(paths).map(([key, entry]) => [key, spelled(entry)]),
    );
    if (JSON.stringify(wanted) !== JSON.stringify(recorded))
      throw new Error('Bound files are stale: run npm run docs:bind:release');
    for (const entry of Object.values(wanted))
      for (const file of entry) await readFile(path.join(root, file));
    process.exit(0);
  }
  const bindings = await collectBindings(model);
  const stale = staleParts(model, bindings);
  if (process.argv.includes('--release')) {
    if (stale.length)
      await updateProjectFile(input, projectContext(model, []), { bindings });
    process.exit(0);
  }
  for (const key of stale) process.stdout.write(key + '\n');
}
