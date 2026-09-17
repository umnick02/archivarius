// What a version promises.
//
// `assets/public-surface.json` is the promise itself: every named export, every
// published subpath, every shipped asset and every contract field a consumer may
// depend on, each with what a minor release may do to it and what only a major
// may. This suite holds the built package to that list. A promise nobody checks
// is a changelog written in advance.
//
// The list is exhaustive for exports, subpaths and assets — an addition nobody
// recorded fails here, because the file is the one place a consumer reads what is
// public. Contract fields are the exception: another release may add an optional
// field, which is exactly what a minor may carry, so an additive difference is
// tolerated and only a breaking one fails.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { contractShape, gradeContract } from '../src/model/contract.mjs';

const root = new URL('../', import.meta.url);
const readJSON = async (file) =>
  JSON.parse(await fs.readFile(new URL(file, root), 'utf8'));
const exists = (file) =>
  fs
    .stat(new URL(file, root))
    .then(() => true)
    .catch(() => false);

const surface = await readJSON('assets/public-surface.json');
const pkg = await readJSON('package.json');
const major = (version) => Number(String(version).split('.')[0]);
const allowsBreaking = (recorded, version) =>
  major(version) > major(recorded.release);

// The export names of a built module, read without running it: a browser entry
// cannot be imported in Node, and a promise is about names, not about a runtime.
const exportsOf = async (file) => {
  const bundled = await build({
    entryPoints: [new URL(file, root).pathname],
    bundle: false,
    write: false,
    metafile: true,
    outdir: 'exports',
    format: 'esm',
    logLevel: 'silent',
  });
  return Object.values(bundled.metafile.outputs)
    .flatMap((output) => output.exports)
    .sort();
};

const target = (subpath) => {
  const entry = pkg.exports[subpath];
  return typeof entry === 'string' ? entry : entry?.import;
};

async function observe() {
  /** @type {Record<string, string[] | null>} */
  const entryPoints = {};
  for (const entry of surface.entryPoints)
    entryPoints[entry.subpath] = pkg.exports[entry.subpath]
      ? await exportsOf(entry.module)
      : null;
  const contracts = {};
  for (const contract of surface.contracts)
    contracts[contract.path] = contractShape(
      await readJSON('dist/' + contract.path),
    );
  return {
    entryPoints,
    contracts,
    assets: (await fs.readdir(new URL('dist/assets/', root))).sort(),
  };
}

// Every way the package can break the promise, in one reading: a subpath or an
// export that is gone, an asset that no longer ships, a contract that lost a
// field, required one it did not, or withdrew a value.
function breakingAgainst(recorded, observed) {
  const changes = [];
  for (const entry of recorded.entryPoints) {
    const now = observed.entryPoints[entry.subpath];
    if (!now) {
      changes.push({ kind: 'subpath-removed', subject: entry.subpath });
      continue;
    }
    for (const name of entry.exports.filter((held) => !now.includes(held)))
      changes.push({
        kind: 'export-removed',
        subject: entry.subpath + '#' + name,
      });
  }
  for (const file of recorded.files)
    for (const name of file.assets ?? [])
      if (!observed.assets.includes(name))
        changes.push({ kind: 'asset-removed', subject: name });
  for (const contract of recorded.contracts) {
    const now = observed.contracts[contract.path];
    if (!now) {
      changes.push({ kind: 'contract-removed', subject: contract.path });
      continue;
    }
    const report = gradeContract(
      {
        title: contract.title,
        version: contract.version,
        locations: contract.shape,
      },
      now,
    );
    for (const change of report.breaking)
      changes.push({
        kind: change.kind,
        subject:
          contract.path +
          ' ' +
          (change.location || '/') +
          (change.field ? '.' + change.field : ''),
      });
  }
  return changes;
}

test('the surface list states what a minor and a major release may do to every entry it holds', () => {
  assert.equal(surface.surface, 1);
  assert.match(surface.release, /^\d+\.\d+\.\d+$/);
  const entries = [
    ...surface.entryPoints,
    ...surface.files,
    ...surface.contracts,
    ...surface.binaries,
  ];
  assert(entries.length > 6, 'the list describes almost nothing');
  for (const entry of entries) {
    const name = entry.subpath ?? entry.path ?? entry.name;
    for (const release of ['minor', 'major']) {
      assert.equal(typeof entry[release], 'string', name + '.' + release);
      assert(
        entry[release].endsWith('.'),
        name + '.' + release + ' is not a sentence',
      );
      assert(
        entry[release].length > 15,
        name + '.' + release + ' says nothing',
      );
    }
  }
});

test('every entry point the surface promises is published and exports exactly what it lists', async () => {
  for (const entry of surface.entryPoints) {
    assert(
      Object.hasOwn(pkg.exports, entry.subpath),
      entry.subpath + ' is not a published subpath',
    );
    assert.equal(target(entry.subpath), './' + entry.module, entry.subpath);
    assert.equal(
      pkg.exports[entry.subpath].types,
      './' + entry.types,
      entry.subpath,
    );
    assert(await exists(entry.module), entry.module + ' is not built');
    assert(await exists(entry.types), entry.types + ' is not built');
    assert.deepEqual(
      await exportsOf(entry.module),
      [...entry.exports].sort(),
      entry.subpath + ' exports something the surface list does not record',
    );
  }
  assert.deepEqual(
    Object.keys(pkg.exports)
      .filter((subpath) => /^\.(?:\/(?:core|node))?$/.test(subpath))
      .sort(),
    surface.entryPoints.map((entry) => entry.subpath).sort(),
    'a module subpath is published that the surface list does not record',
  );
});

test('every file, asset and binary the surface promises is packaged', async () => {
  for (const file of surface.files) {
    assert(
      Object.hasOwn(pkg.exports, file.subpath),
      file.subpath + ' is not a published subpath',
    );
    assert(await exists(file.path), file.path + ' is not built');
  }
  for (const binary of surface.binaries) {
    assert.equal(pkg.bin[binary.name], './' + binary.path, binary.name);
    assert(await exists(binary.path), binary.path + ' is not built');
  }
  const shipped = (await fs.readdir(new URL('dist/assets/', root))).sort();
  const listed = surface.files.flatMap((file) => file.assets ?? []).sort();
  assert.deepEqual(
    shipped,
    listed,
    'the shipped assets and the recorded asset paths differ',
  );
});

test('the shipped surface list travels with the package it describes', async () => {
  assert.equal(
    await fs.readFile(new URL('dist/assets/public-surface.json', root), 'utf8'),
    await fs.readFile(new URL('assets/public-surface.json', root), 'utf8'),
  );
  assert(
    surface.files.some((file) =>
      (file.assets ?? []).includes('public-surface.json'),
    ),
    'the list does not record itself as shipped',
  );
});

test('the recorded contract shapes hold the shipped schemas to an additive change', async () => {
  const observed = await observe();
  const breaking = breakingAgainst(surface, observed);
  if (!allowsBreaking(surface, pkg.version))
    assert.deepEqual(
      breaking,
      [],
      'the package breaks the surface recorded for ' +
        surface.release +
        '; only a new major may',
    );
  for (const contract of surface.contracts) {
    assert.equal(observed.contracts[contract.path].title, contract.title);
    assert.equal(observed.contracts[contract.path].version, contract.version);
  }
});

test('a lost export, a vanished subpath, a dropped asset or a tightened contract is refused inside a major', async () => {
  const observed = await observe();
  const without = (change) => {
    const copy = structuredClone(observed);
    change(copy);
    return breakingAgainst(surface, copy);
  };
  const first = surface.entryPoints[0];
  assert.deepEqual(
    without((copy) => copy.entryPoints[first.subpath].shift()),
    [
      {
        kind: 'export-removed',
        subject: first.subpath + '#' + [...first.exports].sort()[0],
      },
    ],
  );
  assert.deepEqual(
    without((copy) => {
      copy.entryPoints[first.subpath] = null;
    }),
    [{ kind: 'subpath-removed', subject: first.subpath }],
  );
  assert.deepEqual(
    without((copy) =>
      copy.assets.splice(copy.assets.indexOf('strings.json'), 1),
    ),
    [{ kind: 'asset-removed', subject: 'strings.json' }],
  );
  const contract = surface.contracts[0];
  const location = Object.keys(contract.shape).find(
    (key) => (contract.shape[key].optional ?? []).length > 0,
  );
  const [optional] = contract.shape[location].optional;
  assert.deepEqual(
    without((copy) => {
      const shape = copy.contracts[contract.path].locations[location];
      shape.required = [...(shape.required ?? []), optional].sort();
    }),
    [
      {
        kind: 'field-required',
        subject: contract.path + ' ' + (location || '/') + '.' + optional,
      },
    ],
  );
  const valued = Object.keys(contract.shape).find(
    (key) => (contract.shape[key].values ?? []).length > 1,
  );
  assert.deepEqual(
    without((copy) => {
      copy.contracts[contract.path].locations[valued].values.pop();
    }),
    [
      {
        kind: 'value-removed',
        subject: contract.path + ' ' + (valued || '/'),
      },
    ],
  );
});

test('only a release that raises the major may take away what the surface listed', () => {
  assert.equal(
    allowsBreaking(surface, major(surface.release) + '.99.99'),
    false,
  );
  assert.equal(allowsBreaking(surface, surface.release), false);
  assert.equal(
    allowsBreaking(surface, major(surface.release) + 1 + '.0.0'),
    true,
  );
  assert.equal(major(pkg.version) >= major(surface.release), true);
});
