import fs, { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { ArchitectureError, parseArchitecture, parseJSON } from './core.mjs';
import { renderDocumentation } from './model/document.mjs';
import { renderProjectReadme } from './model/project-readme.mjs';
import { analyzeProject } from './model/project-analysis.mjs';
import { applyProjectChanges } from './model/project-authoring.mjs';
import { assertProject } from './model/project-contract.mjs';
import {
  contractDigest,
  definitionBasis,
  realizationDigest,
} from './model/project-digest.mjs';
import { diffProject } from './model/project-diff.mjs';
import { initialProject } from './model/init.mjs';
import { projectHistory, renderProjectHistory } from './model/history.mjs';
import {
  verifyProjectEvidence,
  relativeArtifactPath,
  runEvidence,
} from './model/evidence.mjs';
import {
  loadProjectStorage,
  storeProjectStorage,
} from './io/project-storage.mjs';
import { digest, hashBytes } from './model/digest.mjs';
import { renderGraph } from './model/export.mjs';
import { observeImports } from './model/imports.mjs';
import { reconcileArchitecture } from './model/reconcile.mjs';
import { readSourceModules } from './io/source-files.mjs';
import { bindingParts, partDigest } from './model/binding.mjs';

export async function readArchitectureFile(file) {
  file = await fs.realpath(file);
  const raw = parseJSON(await readFile(file, 'utf8'));
  if (raw?.version === 4)
    return assertProject(await loadProjectStorage(file, raw));
  return parseArchitecture(JSON.stringify(raw));
}

export async function generateDocumentation(model) {
  const copy = JSON.parse(
    await readFile(
      new URL('../assets/archivarius-strings.json', import.meta.url),
      'utf8',
    ),
  );
  copy.project = JSON.parse(
    await readFile(
      new URL('../assets/archivarius-project-strings.json', import.meta.url),
      'utf8',
    ),
  );
  return renderDocumentation(model, copy);
}

// The landing page states only what the model binds to a file, so it stays a
// summary; `generateDocumentation` remains the full reference over every record.
export async function generateReadme(model) {
  return renderProjectReadme(
    model,
    JSON.parse(
      await readFile(
        new URL('../assets/archivarius-project-strings.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}

// The snapshot as the graph other tools read. It needs no shipped strings: a
// DOT file, a mermaid flowchart and a record table carry the model's own words.
export function generateGraph(model, format = 'dot') {
  return renderGraph(model, format);
}

// What changed between two stored snapshots, read without Git: the release
// history is the snapshot's own manifests walked in pairs through the same diff
// the `diff` command reports.
export function generateHistory(model) {
  return renderProjectHistory(projectHistory(assertProject(model)));
}

// A starting point is only a starting point if it cannot land on work already
// done, so the write refuses an existing path instead of merging into it.
export async function initProjectFile(file, options = {}) {
  const model = initialProject(options);
  const target = path.resolve(file);
  if (
    await fs.lstat(target).then(
      () => true,
      () => false,
    )
  )
    throw new ArchitectureError('SNAPSHOT_EXISTS');
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, JSON.stringify(model, null, 2) + '\n', {
      flag: 'wx',
    });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ArchitectureError('SNAPSHOT_EXISTS');
    throw error;
  }
  return model;
}

// Reads an artifact only from inside the project directory. Internal: evidence
// verification is the supported entry point, not raw artifact bytes.
async function readProjectArtifact(directory, name) {
  if (!relativeArtifactPath(name)) throw new ArchitectureError('ARTIFACT_PATH');
  const root = await fs.realpath(directory),
    actual = await fs.realpath(path.resolve(root, name));
  if (!actual.startsWith(root + path.sep))
    throw new ArchitectureError('ARTIFACT_PATH');
  return new Uint8Array(await fs.readFile(actual));
}

// The description read against the code, not against its own digests. A digest
// proves a file has not moved; only the imports say whether the dependency a
// record declares is the one the code has. The report names both directions of
// the disagreement and, so it cannot flatter itself, the edges it could not
// attribute to any described part.
export async function reconcileProjectFiles(file, directory, options = {}) {
  const model = assertProject(await readArchitectureFile(file));
  const modules = await readSourceModules(directory, options);
  return {
    ...reconcileArchitecture(model, observeImports(modules)),
    observed: modules.length,
  };
}

export async function verifyProjectFiles(model, directory) {
  const evidence = await verifyProjectEvidence(model, (name) =>
    readProjectArtifact(directory, name),
  );
  return { ...evidence, analysis: analyzeProject(model, evidence) };
}

// What moved between two snapshot files, and what lost its basis as a result.
// Without an earlier file the model is read against its own most recent stored
// manifest, which is the freshness report over one snapshot.
export async function diffProjectFiles(file, against = null) {
  const model = assertProject(await readArchitectureFile(file));
  return diffProject(
    model,
    against ? assertProject(await readArchitectureFile(against)) : null,
  );
}

export async function writeAtomic(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function mutateProjectFile(file, transform, archive = false) {
  file = await fs.realpath(file);
  const lock = file + '.lock';
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new ArchitectureError('MODEL_BUSY');
    throw error;
  }
  try {
    const model = await readArchitectureFile(file);
    const next = transform(model);
    if (digest(await readArchitectureFile(file)) !== digest(model))
      throw new ArchitectureError('CONTEXT_CHANGED');
    await storeProjectStorage(file, next, model, archive, writeAtomic);
    return next;
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}

export async function updateProjectFile(file, context, change) {
  return mutateProjectFile(file, (model) =>
    applyProjectChanges(model, context, change),
  );
}

export async function archiveProjectFile(file) {
  return mutateProjectFile(file, (model) => model, true);
}

export async function executeProjectCheck(
  model,
  key,
  {
    directory,
    resultKey,
    evidencePath,
    timeout = 60000,
    resolves = [],
    resolution,
  } = {},
) {
  assertProject(model);
  const check = model.records.find((r) => r.key === key && r.type === 'check');
  const command = check?.command;
  if (!check || !analyzeProject(model).freshness[key].current)
    throw new ArchitectureError('CHECK_NOT_CURRENT', [key]);
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((arg) => typeof arg !== 'string')
  )
    throw new ArchitectureError('COMMAND_REQUIRED');
  if (!relativeArtifactPath(evidencePath))
    throw new ArchitectureError('ARTIFACT_PATH');
  if (!Object.keys(model.bindings).length)
    throw new ArchitectureError('BINDINGS_REQUIRED');
  // A binding answers for the lines it claims, not for every edit in the file, so
  // each part is hashed over exactly the text it names.
  const verifyBindings = async () => {
    for (const binding of Object.values(model.bindings))
      for (const part of bindingParts(binding))
        if (
          partDigest(await readProjectArtifact(directory, part.path), part) !==
          part.digest
        )
          throw new ArchitectureError('REALIZATION_CHANGED');
  };
  await verifyBindings();
  const contract = contractDigest(model),
    realization = realizationDigest(model),
    startedAt = new Date().toISOString();
  const run = await new Promise((resolve) =>
    execFile(
      command[0],
      command.slice(1),
      { cwd: directory, timeout, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          exitCode: error
            ? Number.isInteger(error.code)
              ? error.code
              : -1
            : 0,
          stdout,
          stderr,
        }),
    ),
  );
  await verifyBindings();
  const outcome = run.exitCode === 0 ? 'pass' : 'fail';
  const evidence = runEvidence(model, check, {
    ...run,
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  const bytes = new TextEncoder().encode(
    JSON.stringify(evidence, null, 2) + '\n',
  );
  const record = {
    key: resultKey,
    type: 'result',
    title: check.title,
    scope: check.scope,
    check: key,
    outcome,
    basis: { contract },
    realization,
    evidence: [{ path: evidencePath, digest: hashBytes(bytes) }],
    // A run that clears an earlier failure answers it: the failure it names stops
    // standing as the state of the check, and the reason is stated beside it. The
    // model holds the pair to its own rule, so a resolution of a run that did not
    // fail, or one with nothing said about it, is refused here rather than stored.
    resolves,
    ...(resolution ? { resolution } : {}),
  };
  // Withdrawal is proportionate for a run too: the receipt names the definitions
  // it rested on - its check and everything that check rests on - so a later edit
  // elsewhere in the snapshot leaves the run standing, and a change to what the
  // check reads withdraws it.
  const proposed = { ...model, records: [...model.records, record] };
  record.basis.definitions = definitionBasis(proposed, resultKey);
  assertProject(proposed);
  const target = path.resolve(directory, evidencePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target)),
    root = await fs.realpath(directory);
  if (parent !== root && !parent.startsWith(root + path.sep))
    throw new ArchitectureError('ARTIFACT_PATH');
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return record;
}

export { exportProjectDocuments } from './io/document-files.mjs';
