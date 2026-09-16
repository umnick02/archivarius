// Disk storage is an immutable hash-linked archive plus one editable current model.
// Core APIs and the viewer always receive the fully hydrated v4 model.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArchitectureError, parseJSON } from '../core.mjs';
import { checkStructure } from '../model/structure.mjs';
import { digest } from '../model/digest.mjs';

const filename = (file) => (file instanceof URL ? fileURLToPath(file) : file);
const archiveDirectory = (file) => filename(file) + '.history';
async function archivePath(file, hash, create = false) {
  if (!/^[0-9a-f]{64}$/.test(hash))
    throw new ArchitectureError('ARCHIVE_REFERENCE');
  const directory = archiveDirectory(file);
  if (create) await fs.mkdir(directory, { recursive: true });
  const actual = await fs.realpath(directory);
  const parent = await fs.realpath(path.dirname(filename(file)));
  if (actual !== path.join(parent, path.basename(directory)))
    throw new ArchitectureError('ARCHIVE_PATH');
  const target = path.join(actual, hash + '.json');
  const stat = await fs.lstat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (stat && !stat.isFile()) throw new ArchitectureError('ARCHIVE_PATH');
  return target;
}
export async function loadProjectStorage(file, raw) {
  if (!raw.archive) return raw;
  const errors = checkStructure(raw);
  if (errors.length || raw.history.length || raw.snapshots.length)
    throw new ArchitectureError('ARCHIVE_STRUCTURE');
  const segments = [],
    seen = new Set();
  let head = raw.archive.head;
  while (head) {
    if (seen.has(head)) throw new ArchitectureError('ARCHIVE_CYCLE');
    seen.add(head);
    const segment = parseJSON(
      await fs.readFile(await archivePath(file, head), 'utf8'),
    );
    if (digest(segment) !== head) throw new ArchitectureError('ARCHIVE_DIGEST');
    if (
      Object.keys(segment).sort().join() !==
        'history,previous,snapshots,version' ||
      segment.version !== 1 ||
      !(segment.previous === null || /^[0-9a-f]{64}$/.test(segment.previous)) ||
      !Array.isArray(segment.history) ||
      !Array.isArray(segment.snapshots)
    )
      throw new ArchitectureError('ARCHIVE_STRUCTURE');
    segments.push(segment);
    head = segment.previous;
  }
  const { archive, ...model } = raw;
  for (const segment of segments.reverse()) {
    model.history.push(...segment.history);
    model.snapshots.push(...segment.snapshots);
  }
  return model;
}

export async function storeProjectStorage(
  file,
  model,
  previous,
  archive,
  writeAtomic,
) {
  const raw = parseJSON(await fs.readFile(file, 'utf8'));
  if (!archive && !raw.archive)
    return writeAtomic(file, JSON.stringify(model, null, 2) + '\n');
  const history = raw.archive
    ? model.history.slice(previous.history.length)
    : model.history;
  const snapshots = raw.archive
    ? model.snapshots.slice(previous.snapshots.length)
    : model.snapshots;
  let head = raw.archive?.head;
  if (!head || history.length || snapshots.length) {
    const segment = { version: 1, previous: head ?? null, history, snapshots };
    head = digest(segment);
    const target = await archivePath(file, head, true);
    // Publish complete archive bytes before switching the current model pointer.
    // Existing content-addressed files must agree, including abandoned prior writes.
    const existing = await fs.readFile(target, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing !== undefined) {
      if (digest(parseJSON(existing)) !== head)
        throw new ArchitectureError('ARCHIVE_DIGEST');
    } else await writeAtomic(target, JSON.stringify(segment, null, 2) + '\n');
  }
  await writeAtomic(
    file,
    JSON.stringify(
      { ...model, history: [], snapshots: [], archive: { version: 1, head } },
      null,
      2,
    ) + '\n',
  );
}
