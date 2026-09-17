import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readArchitecture,
  readResources,
  prepareArchitecture,
} from '../src/ui/load.mjs';
import { architectureLimits } from '../src/model/parse.mjs';
import { hashBytes } from '../src/model/digest.mjs';
import {
  contractDigest,
  realizationDigest,
} from '../src/model/project-digest.mjs';
import { bind, get, ready, seal, receipt } from './project-fixture.mjs';

const architecture = JSON.parse(
  await fs.readFile(
    new URL('../models/rendering.json', import.meta.url),
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
// Cancellation is watched, never slept on: a turn of the loop is enough for any
// work the loader still had queued to show up in the stub's records.
const tick = () => new Promise((resolve) => setImmediate(resolve));

// A project whose one result is confirmable from the files a page can fetch: the
// model, the bound source it hashes and the receipt that covers the run.
const confirmable = () => {
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
  return {
    model,
    record,
    routes: {
      '/app/project.json': JSON.stringify(model),
      '/app/fixture.mjs': () => new Response(binding),
      '/app/run.json': () => new Response(evidence),
    },
  };
};
// A response the test hands over on demand, counting every read of its body: the
// loader is only allowed to decode a document a caller still wants.
const gated = (reads, name, body) => {
  const answers = [];
  const route = () =>
    new Promise((resolve) => {
      answers.push(() =>
        resolve({
          ok: true,
          status: 200,
          text: async () => {
            reads.push(name);
            return body;
          },
        }),
      );
    });
  return { route, answers };
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
  const files = [
    'archivarius-strings.json',
    'archivarius-contracts.json',
    'archivarius-project-strings.json',
  ];
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
  const { model, record, routes } = confirmable();
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

// Cancellation is part of the contract, not a nicety: a caller that withdraws
// stops the work at the next stage boundary and gets a cancellation back, and a
// load a newer one replaced can never land on top of it.
test('a withdrawn load stops before it decodes anything and settles as a cancellation', async (t) => {
  const fixture = confirmable();
  const reads = [];
  const model = gated(reads, 'project.json', JSON.stringify(fixture.model));
  const asked = serve(t, {
    ...fixture.routes,
    '/app/project.json': model.route,
  });
  const controller = new AbortController();
  const pending = prepareArchitecture(base + 'project.json', {
    signal: controller.signal,
  });
  while (!model.answers.length) await tick();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  // The answer the loader was waiting for arrives after the withdrawal: nothing
  // may read it, parse it or go on to fetch the artifacts it names.
  model.answers[0]();
  await tick();
  await tick();
  assert.deepEqual(reads, [], 'the abandoned response was still decoded');
  assert.deepEqual(
    asked,
    [base + 'project.json'],
    'the loader kept fetching after the caller withdrew',
  );
});

test('a load superseded on the same handle is withdrawn by name and cannot overwrite the newer one', async (t) => {
  const reads = [];
  const first = gated(reads, 'first', JSON.stringify(architecture));
  const second = gated(
    reads,
    'second',
    JSON.stringify({ ...architecture, title: 'Replacement' }),
  );
  serve(t, {
    '/app/first.json': first.route,
    '/app/second.json': second.route,
  });
  const handle = {};
  const stale = prepareArchitecture(base + 'first.json', { handle });
  while (!first.answers.length) await tick();
  const fresh = prepareArchitecture(base + 'second.json', { handle });
  while (!second.answers.length) await tick();
  await assert.rejects(stale, {
    name: 'AbortError',
    message: 'LOAD_SUPERSEDED',
  });
  // The superseded answer comes back late; only the newer load may be served.
  first.answers[0]();
  second.answers[0]();
  const prepared = await fresh;
  assert.equal(prepared.input.title, 'Replacement');
  await tick();
  await tick();
  assert.deepEqual(reads, ['second'], 'a superseded load kept working');
});

test('every stated bound is published and refuses an input past it by name and value', async (t) => {
  serve(t, {});
  assert.deepEqual(Object.keys(architectureLimits).sort(), [
    'maxBytes',
    'maxDepth',
    'maxRecords',
    'maxRelations',
  ]);
  assert(Object.isFrozen(architectureLimits), 'the bounds can be rewritten');
  for (const value of Object.values(architectureLimits))
    assert(Number.isInteger(value) && value > 0, String(value));
  const past = (bound, value, code) => (error) => {
    assert.equal(error.code, code, error.message);
    assert(error.message.includes(bound), error.message);
    assert(error.message.includes(String(value)), error.message);
    assert(
      error.message.includes(String(architectureLimits[bound])),
      error.message,
    );
    assert.deepEqual(error.diagnostics[0].params, {
      bound,
      value: String(value),
      limit: String(architectureLimits[bound]),
    });
    return true;
  };
  const padding = 'x'.repeat(architectureLimits.maxBytes);
  const padded = '{"version":3,"padding":"' + padding + '"}';
  await assert.rejects(
    readArchitecture(new Blob([padded])),
    past('maxBytes', padded.length, 'MODEL_TOO_LARGE'),
  );
  const records = architectureLimits.maxRecords + 1;
  await assert.rejects(
    readArchitecture({
      version: 3,
      nodes: Array.from({ length: records }, (unused, i) => ({ key: 'n' + i })),
      relations: [],
    }),
    past('maxRecords', records, 'MODEL_TOO_MANY_RECORDS'),
  );
  const relations = architectureLimits.maxRelations + 1;
  await assert.rejects(
    readArchitecture({
      version: 3,
      nodes: [],
      relations: Array.from({ length: relations }, (unused, i) => ({
        key: 'r' + i,
      })),
    }),
    past('maxRelations', relations, 'MODEL_TOO_MANY_RELATIONS'),
  );
  const depth = architectureLimits.maxDepth + 1;
  let node = { key: 'leaf' };
  for (let level = depth - 1; level > 0; level--)
    node = { key: 'level-' + level, children: [node] };
  await assert.rejects(
    readArchitecture({ version: 3, nodes: [node], relations: [] }),
    past('maxDepth', depth, 'MODEL_TOO_DEEP'),
  );
  // A model inside every bound is still read the ordinary way.
  assert.deepEqual(
    await readArchitecture(new Blob([JSON.stringify(architecture)])),
    architecture,
  );
});
