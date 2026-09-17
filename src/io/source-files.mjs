import fs from 'node:fs/promises';
import path from 'node:path';

// The modules a reconciliation reads. Walking the tree is I/O, so it lives here;
// what the text means is the model's business. Only the extensions the project
// writes are read, and nothing outside the directory is followed: a symlink is
// skipped rather than resolved, so a link out of the project cannot smuggle a
// dependency into the report.
const readable = new Set(['.mjs', '.js', '.jsx', '.cjs']);

/**
 * Every readable module under one directory, as repository-relative paths and
 * their text, in a stable order.
 *
 * @param {string} directory the project root
 * @param {object} [options]
 * @param {string[]} [options.within] the subdirectories to walk
 * @param {string[]} [options.skip] directory names never entered
 * @returns {Promise<{ path: string, text: string }[]>}
 */
export async function readSourceModules(
  directory,
  { within = ['src'], skip = ['node_modules', 'dist', '.git'] } = {},
) {
  const root = await fs.realpath(directory);
  const skipped = new Set(skip);
  const modules = [];
  const walk = async (relative) => {
    const absolute = path.join(root, relative);
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink() || skipped.has(entry.name)) continue;
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile() && readable.has(path.extname(entry.name)))
        modules.push({
          path: next,
          text: await fs.readFile(path.join(root, next), 'utf8'),
        });
    }
  };
  for (const start of within)
    await walk(start).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  return modules;
}
