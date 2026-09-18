import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { ArchitectureError } from '../model/errors.mjs';
import { parseJSON } from '../model/parse.mjs';

const execute = promisify(execFile);
async function git(directory, args) {
  try {
    const { stdout } = await execute(
      'git',
      ['--no-replace-objects', '--literal-pathspecs', '-C', directory, ...args],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    throw new ArchitectureError('GIT_HISTORY_UNAVAILABLE', [directory]);
  }
}

export async function projectGitSource(file) {
  file = await fs.realpath(file);
  const root = (
    await git(path.dirname(file), ['rev-parse', '--show-toplevel'])
  ).trim();
  const relative = path.relative(root, file).split(path.sep).join('/');
  const commit = (
    await git(root, ['rev-parse', '--verify', 'HEAD^{commit}'])
  ).trim();
  return { root, path: relative, commit };
}

export async function readGitProjectJSON(source) {
  const name = source.path;
  if (
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(source.commit) ||
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    path.posix.isAbsolute(name) ||
    path.posix.normalize(name) !== name ||
    name.split('/').some((part) => part === '..' || part === '.')
  )
    throw new ArchitectureError('GIT_HISTORY_REFERENCE');
  return parseJSON(
    await git(source.root, ['show', `${source.commit}:${name}`]),
  );
}
