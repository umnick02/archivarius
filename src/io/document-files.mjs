import fs from 'node:fs/promises';
import path from 'node:path';
import { assertProject } from '../model/project-contract.mjs';
import { renderDocument } from '../model/documents.mjs';

// Preflight every destination before writing. Never follow a document path through
// a symlink, even when it currently happens to resolve inside the output root.
export async function exportProjectDocuments(
  model,
  directory,
  { check = false, source } = {},
) {
  assertProject(model);
  const root = await fs.realpath(directory);
  const sourcePath = source
    ? await fs.realpath(source).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return path.resolve(source);
      })
    : undefined;
  const files = [];
  for (const document of model.records.filter(
    (record) => record.type === 'document',
  )) {
    const target = path.resolve(root, document.path);
    if (!target.startsWith(root + path.sep) || target === sourcePath)
      throw new Error('DOCUMENT_DESTINATION:' + document.path);
    let current = root;
    for (const part of document.path.split('/')) {
      current = path.join(current, part);
      const info = await fs.lstat(current).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (info?.isSymbolicLink())
        throw new Error('DOCUMENT_SYMLINK:' + document.path);
    }
    files.push({
      path: document.path,
      target,
      content: renderDocument(model, document),
    });
  }
  if (!files.length) throw new Error('DOCUMENTS_MISSING');
  const drift = [];
  for (const file of files) {
    const previous = await fs.readFile(file.target, 'utf8').catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (previous === file.content) continue;
    drift.push(file.path);
    if (!check) {
      await fs.mkdir(path.dirname(file.target), { recursive: true });
      const temp = file.target + '.archivarius-' + process.pid;
      try {
        await fs.writeFile(temp, file.content, { flag: 'wx' });
        await fs.rename(temp, file.target);
      } finally {
        await fs.rm(temp, { force: true });
      }
    }
  }
  if (check && drift.length)
    throw new Error('DOCUMENTS_OUT_OF_DATE:' + drift.join(','));
  return { files: files.map((file) => file.path), changed: drift };
}
