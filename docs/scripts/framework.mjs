import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// The documentation model is validated and served by this repository's own
// built library, not a cloned framework: docs describe Archivarius itself.
export const root = fileURLToPath(new URL('../../', import.meta.url));
export const input = path.join(root, 'project.json');
export const cli = path.join(root, 'dist/src/cli.mjs');

export function requireBuild() {
  if (!existsSync(cli))
    throw new Error('Build the library first: npm run build');
}

export function runCli(command, args = []) {
  requireBuild();
  return execFileSync(process.execPath, [cli, command, input, ...args], {
    cwd: root,
    stdio: 'inherit',
    timeout: 300000,
  });
}
