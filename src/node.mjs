import fs, { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { ArchitectureError, parseArchitecture } from './core.mjs';
import { renderDocumentation } from './document.mjs';
import {
  assertProject,
  analyzeProject,
  applyProjectChanges,
  contractDigest,
  realizationDigest,
} from './project.mjs';
import { verifyProjectEvidence, relativeArtifactPath } from './evidence.mjs';
import { digest, hashBytes } from './digest.mjs';

export async function readArchitectureFile(path) {
  return parseArchitecture(await readFile(path, 'utf8'));
}

export async function generateDocumentation(model, { locale = 'ru' } = {}) {
  if (!['ru', 'en'].includes(locale))
    throw new ArchitectureError('UNSUPPORTED_LOCALE');
  const copy = JSON.parse(
    await readFile(
      new URL('../assets/' + locale + '.json', import.meta.url),
      'utf8',
    ),
  );
  copy.project = JSON.parse(
    await readFile(
      new URL('../assets/project.' + locale + '.json', import.meta.url),
      'utf8',
    ),
  );
  return renderDocumentation(model, copy);
}

export async function readProjectArtifact(directory, name) {
  if (!relativeArtifactPath(name)) throw new ArchitectureError('ARTIFACT_PATH');
  const root = await fs.realpath(directory),
    actual = await fs.realpath(path.resolve(root, name));
  if (!actual.startsWith(root + path.sep))
    throw new ArchitectureError('ARTIFACT_PATH');
  return new Uint8Array(await fs.readFile(actual));
}

export async function verifyProjectFiles(model, directory) {
  const evidence = await verifyProjectEvidence(model, (name) =>
    readProjectArtifact(directory, name),
  );
  return { ...evidence, analysis: analyzeProject(model, evidence) };
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

export async function updateProjectFile(file, context, change) {
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
    const next = applyProjectChanges(model, context, change);
    if (digest(await readArchitectureFile(file)) !== digest(model))
      throw new ArchitectureError('CONTEXT_CHANGED');
    await writeAtomic(file, JSON.stringify(next, null, 2) + '\n');
    return next;
  } finally {
    await handle.close();
    await fs.rm(lock, { force: true });
  }
}

export async function executeProjectCheck(
  model,
  key,
  { directory, resultKey, evidencePath, timeout = 60000 } = {},
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
  const verifyBindings = async () => {
    for (const binding of Object.values(model.bindings))
      if (
        hashBytes(await readProjectArtifact(directory, binding.path)) !==
        binding.digest
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
  const evidence = {
    version: 1,
    check: key,
    contract,
    realization,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    outcome,
    ...run,
  };
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
    resolves: [],
  };
  assertProject({ ...model, records: [...model.records, record] });
  const target = path.resolve(directory, evidencePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const parent = await fs.realpath(path.dirname(target)),
    root = await fs.realpath(directory);
  if (parent !== root && !parent.startsWith(root + path.sep))
    throw new ArchitectureError('ARTIFACT_PATH');
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return record;
}

export { exportProjectDocuments } from './document-files.mjs';
