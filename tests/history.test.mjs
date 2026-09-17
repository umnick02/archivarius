// What changed between two versions has to be readable without Git, so the
// release history is generated from the snapshot itself: every stored manifest
// walked in pairs through the same diff the `diff` command reports. The terms
// ship beside it — the MIT licence is part of the package, not a promise.
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { projectHistory, renderProjectHistory } from '../src/model/history.mjs';
import { generateHistory } from '../src/node.mjs';
import {
  applyProjectChanges,
  projectContext,
} from '../src/model/project-authoring.mjs';
import { digest } from '../src/model/digest.mjs';
import {
  contractDigest,
  realizationDigest,
  snapshotManifest,
} from '../src/model/project-digest.mjs';
import { generatedNotice } from '../src/model/documents.mjs';
import { get, ready } from './project-fixture.mjs';

const root = new URL('../', import.meta.url);

// Two authored edits over the shared fixture, so the model carries two stored
// manifests and the history has two transitions to report.
const edited = () => {
  const first = ready();
  const requirement = get(first, 'explicit-result');
  const second = applyProjectChanges(
    first,
    projectContext(first, ['explicit-result']),
    {
      put: [
        {
          ...requirement,
          rule: requirement.rule + ' The reason names the rule that refused.',
        },
      ],
    },
  );
  const screen = get(second, 'screen');
  return applyProjectChanges(second, projectContext(second, ['screen']), {
    put: [{ ...screen, title: screen.title + ' (owner view)' }],
    remove: [],
  });
};

test('the history is one version per stored snapshot, newest first', () => {
  const model = edited();
  const history = projectHistory(model);
  assert.equal(history.title, model.title);
  assert.equal(history.versions.length, model.snapshots.length + 1);
  // The newest version is the model as it stands, and it names the snapshot,
  // contract and realization digests the diff command reports for it.
  const [current] = history.versions;
  assert.equal(current.snapshot, digest(snapshotManifest(model)));
  assert.equal(current.contract, contractDigest(model));
  assert.equal(current.realization, realizationDigest(model));
  assert.equal(current.current, true);
  assert.equal(
    history.versions.at(-1).snapshot,
    digest(model.snapshots[0]),
    'the oldest version is the first manifest the model stored',
  );
  assert.deepEqual(
    history.versions.map((version) => version.current),
    [true, ...model.snapshots.slice(1).map(() => false), false],
  );
  // The oldest version has nothing before it, so it reports no change at all.
  const oldest = history.versions.at(-1);
  assert.deepEqual(
    [oldest.added, oldest.removed, oldest.changed, oldest.previous],
    [[], [], [], null],
  );
});

test('each version names the records it added, removed and changed', () => {
  const history = projectHistory(edited());
  const current = history.versions[0];
  assert.deepEqual(
    current.changed.map((record) => [record.key, record.fields]),
    [['screen', ['title']]],
  );
  assert.deepEqual(current.added, []);
  assert.deepEqual(current.removed, []);
  const before = history.versions[1];
  assert.deepEqual(
    before.changed.map((record) => [record.key, record.fields]),
    [['explicit-result', ['rule']]],
  );
  assert.equal(before.previous, history.versions[2].snapshot);
  assert.equal(current.previous, before.snapshot);
});

test('a snapshot with no stored manifest is one version and no change', () => {
  const history = projectHistory(ready());
  assert.equal(history.versions.length, 1);
  assert.deepEqual(history.versions[0].added, []);
  assert.deepEqual(history.versions[0].previous, null);
});

test('the rendered history reads the versions and nothing else, the same way twice', () => {
  const model = edited();
  const history = projectHistory(model);
  const markdown = renderProjectHistory(history);
  assert.equal(markdown, renderProjectHistory(projectHistory(model)));
  assert.equal(markdown, generateHistory(model));
  assert(markdown.startsWith(generatedNotice), 'the history is generated');
  assert(markdown.endsWith('\n'), 'a document ends with a newline');
  for (const version of history.versions)
    assert(
      markdown.includes(version.snapshot),
      version.snapshot + ' is not in the document',
    );
  assert(markdown.includes('screen'), 'a changed record is not named');
  assert(markdown.includes('explicit-result'), 'a changed record is not named');
  assert(
    markdown.includes(get(model, 'screen').title),
    'a changed record is not titled',
  );
  // A version with nothing added does not print an empty list.
  assert(!/### Added\n\n### /.test(markdown), 'an empty section was printed');
});

test('the history command writes the document and refuses drift', async (t) => {
  const directory = await fs.mkdtemp(new URL('.runtime/history-', root));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const model = edited();
  const file = path.join(directory, 'project.json'),
    output = path.join(directory, 'HISTORY.md');
  await fs.writeFile(file, JSON.stringify(model));
  const run = (args) =>
    spawnSync(process.execPath, ['src/cli.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  assert.equal(
    execFileSync(
      process.execPath,
      ['src/cli.mjs', 'history', file, '--output', output],
      { cwd: root, encoding: 'utf8' },
    ).trim(),
    output,
  );
  assert.equal(await fs.readFile(output, 'utf8'), generateHistory(model));
  assert.equal(run(['history', file, '--output', output, '--check']).status, 0);
  await fs.appendFile(output, 'edited by hand\n');
  const drifted = run(['history', file, '--output', output, '--check']);
  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /DOCUMENT_OUT_OF_DATE/);
  // The history is never written over the model it reads.
  const onto = run(['history', file, '--output', file]);
  assert.equal(onto.status, 1);
  assert.match(onto.stderr, /OUTPUT_IS_MODEL/);
  assert.equal(run(['history', file]).status, 2);
});

test('the help text offers history', async () => {
  const help = await fs.readFile(
    new URL('assets/archivarius-cli-help.txt', root),
    'utf8',
  );
  assert.match(help, /^\s+archivarius history <project\.json> --output/m);
});

// The terms are part of the package a consumer installs, not a claim in prose.
test('the MIT licence ships with the package', async () => {
  const licence = await fs.readFile(new URL('LICENSE', root), 'utf8');
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Permission is hereby granted, free of charge/);
  assert.match(licence, /WITHOUT WARRANTY OF ANY KIND/);
  const pkg = JSON.parse(await fs.readFile(new URL('package.json', root)));
  assert.equal(pkg.license, 'MIT');
  // npm packs the licence with every tarball, whatever `files` lists. Scripts are
  // off: what the tarball carries is decided by `files` and npm's own defaults,
  // and letting `prepare` rebuild dist/ here would pull it out from under the
  // suites running beside this one.
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
  assert(
    packed[0].files.some((entry) => entry.path === 'LICENSE'),
    'the tarball carries no LICENSE',
  );
});
