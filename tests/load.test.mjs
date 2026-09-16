import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readArchitecture,
  readResources,
  prepareArchitecture,
} from '../src/ui/load.mjs';
import { hashBytes } from '../src/model/digest.mjs';
import {
  contractDigest,
  realizationDigest,
} from '../src/model/project-digest.mjs';
import { bind, get, ready, seal, receipt } from './project-fixture.mjs';

const architecture = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/architecture.json', import.meta.url),
    'utf8',
  ),
);
const base = 'https://example.test/app/';
// The browser reads over the network, so the network is the fixture: a stub that
// answers by pathname and records what was asked proves both the parsing and the
// URLs the loader resolves.
const serve = (t, routes) => {
  const asked = [];
  const original = globalThis.fetch;
  const document = globalThis.document;
  globalThis.document = { baseURI: base };
  globalThis.fetch = async (input) => {
    const url = new URL(input, base);
    asked.push(url.href);
    const route = routes[url.pathname];
    if (route === undefined) return new Response('', { status: 404 });
    if (typeof route === 'function') return route();
    return new Response(route);
  };
  t.after(() => {
    globalThis.fetch = original;
    globalThis.document = document;
  });
  return asked;
};

test('a model read over the network is parsed, and every failed read names itself', async (t) => {
  serve(t, { '/app/architecture.json': JSON.stringify(architecture) });
  assert.deepEqual(
    await readArchitecture(base + 'architecture.json'),
    architecture,
  );
  assert.deepEqual(
    await readArchitecture(new URL(base + 'architecture.json')),
    architecture,
  );
  await assert.rejects(readArchitecture(base + 'absent.json'), {
    code: 'MODEL_LOAD_FAILED',
    issues: ['404'],
  });
  globalThis.fetch = () => Promise.reject(new Error('OFFLINE'));
  await assert.rejects(readArchitecture(base + 'architecture.json'), {
    code: 'MODEL_LOAD_FAILED',
  });
});

test('a cancelled read reports the cancellation rather than a load failure', async (t) => {
  serve(t, {});
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    readArchitecture(base + 'architecture.json', { signal: before.signal }),
    { name: 'AbortError' },
  );
  const during = new AbortController();
  globalThis.fetch = () => {
    during.abort();
    return Promise.reject(new Error('ABORTED'));
  };
  await assert.rejects(
    readArchitecture(base + 'architecture.json', { signal: during.signal }),
    { name: 'AbortError' },
  );
});

test('a dropped file and a passed object take the same contract as a fetched model', async (t) => {
  serve(t, {});
  assert.deepEqual(
    await readArchitecture(
      new Blob([JSON.stringify(architecture)], { type: 'application/json' }),
    ),
    architecture,
  );
  assert.deepEqual(await readArchitecture(architecture), architecture);
  await assert.rejects(
    readArchitecture({ ...architecture, callback: () => {} }),
    { code: 'INVALID_MODEL' },
  );
  const broken = structuredClone(architecture);
  broken.relations[0].to = 'absent';
  await assert.rejects(readArchitecture(broken), (error) => {
    assert.equal(error.code, 'INVALID_MODEL');
    assert(error.diagnostics.length || error.issues.length);
    return true;
  });
});

test('shipped copy is read beside the package, or beside the base a host names', async (t) => {
  const files = ['strings.json', 'contracts.json', 'project.json'];
  const bodies = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        '/app/assets/' + file,
        await fs.readFile(
          new URL('../assets/' + file, import.meta.url),
          'utf8',
        ),
      ]),
    ),
  );
  const asked = serve(t, bodies);
  const resources = await readResources({ assetsBaseUrl: 'assets/' });
  assert.equal(resources.copy.locale, 'en');
  assert(resources.contracts);
  assert(resources.projectCopy);
  assert.deepEqual(
    asked.sort(),
    files.map((file) => base + 'assets/' + file).sort(),
  );
  globalThis.fetch = async () => new Response('', { status: 500 });
  await assert.rejects(readResources({ assetsBaseUrl: 'assets/' }), {
    code: 'RESOURCES_LOAD_FAILED',
  });
  globalThis.fetch = () => Promise.reject(new Error('OFFLINE'));
  await assert.rejects(readResources({ assetsBaseUrl: 'assets/' }), {
    code: 'RESOURCES_LOAD_FAILED',
  });
});

test('the browser confirms a project against the artifacts it can fetch, and refuses the ones it cannot', async (t) => {
  const binding = new TextEncoder().encode('export const check = true;\n');
  const model = ready();
  bind(model, hashBytes(binding));
  get(model, 'export-check').command = ['node', 'fixture.mjs'];
  seal(model);
  const record = receipt(model);
  const evidence = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      check: record.check,
      contract: contractDigest(model),
      realization: realizationDigest(model),
      outcome: 'pass',
      command: get(model, 'export-check').command,
      exitCode: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
    }),
  );
  record.evidence = [{ path: 'run.json', digest: hashBytes(evidence) }];
  model.records.push(record);
  const routes = {
    '/app/project.json': JSON.stringify(model),
    '/app/fixture.mjs': () => new Response(binding),
    '/app/run.json': () => new Response(evidence),
  };
  serve(t, routes);
  const prepared = await prepareArchitecture(base + 'project.json');
  assert.deepEqual(prepared.evidence.verifiedResults, [record.key]);
  assert.equal(prepared.analysis.completion[model.root].implemented, true);
  assert(prepared.graph.nodes.size > 0);

  // An artifact the page cannot fetch, and one whose path leaves the model's
  // own directory, both fail the receipt instead of confirming it.
  serve(t, { ...routes, '/app/run.json': undefined });
  const unavailable = await prepareArchitecture(base + 'project.json');
  assert.deepEqual(unavailable.evidence.verifiedResults, []);
  assert.equal(unavailable.analysis.completion[model.root].implemented, false);
  const escaping = structuredClone(model);
  escaping.records.at(-1).evidence = [
    { path: '/etc/run.json', digest: record.evidence[0].digest },
  ];
  serve(t, { ...routes, '/app/project.json': JSON.stringify(escaping) });
  const rejected = await prepareArchitecture(base + 'project.json');
  assert.deepEqual(rejected.evidence.verifiedResults, []);
  assert(
    rejected.evidence.diagnostics.some((d) => d.code === 'ARTIFACT_PATH'),
    JSON.stringify(rejected.evidence.diagnostics),
  );
});
