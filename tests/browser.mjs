import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connectBrowser, pause } from './cdp.mjs';
import { generateDocumentation } from '../src/node.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/architecture.json', import.meta.url),
    'utf8',
  ),
);
const copy = JSON.parse(
  await fs.readFile(new URL('../assets/ru.json', import.meta.url), 'utf8'),
);
const english = JSON.parse(
  await fs.readFile(new URL('../assets/en.json', import.meta.url), 'utf8'),
);
const b = await connectBrowser();
const state = (name = 'first') =>
  b.evaluate((name) => window.consumer[name].snapshot(), name);
const focus = async (key) => {
  await b.evaluate((key) => window.consumer.first.focus(key), key);
  await pause(150);
};
const click = async (selector, count = 1) => {
  const point = await b.evaluate((selector) => {
    const element = document.querySelector(selector);
    element.scrollIntoView({ block: 'nearest' });
    const r = element.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await b.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: count,
  });
  await b.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: count,
  });
  await pause(400);
};
const load = (data) =>
  b.evaluate(async (data) => {
    await window.consumer.first.load(
      new File([JSON.stringify(data)], 'architecture.json', {
        type: 'application/json',
      }),
    );
  }, data);
const checkIds = async () => {
  const ids = await b.evaluate(() =>
    [...document.querySelectorAll('[id]')].map((e) => e.id),
  );
  assert.equal(new Set(ids).size, ids.length);
};
const downloads = new URL('../.runtime/downloads/', import.meta.url);
await fs.mkdir(downloads, { recursive: true });
const checkDownload = async (data, name = 'first', locale = 'ru') => {
  const output = new URL('architecture.md', downloads);
  await fs.rm(output, { force: true });
  await b.call('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads.pathname,
  });
  await click('#' + name + ' [data-control=about]');
  await click('#' + name + ' [data-control=download-docs]');
  let text;
  for (let i = 0; i < 50; i++) {
    text = await fs.readFile(output, 'utf8').catch(() => undefined);
    if (text !== undefined) break;
    await pause(100);
  }
  assert.equal(text, await generateDocumentation(data, { locale }));
  await click('#' + name + ' [data-control=close]');
};

try {
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.call('Page.navigate', {
    url: 'http://127.0.0.1:44891/embedded/maps/',
  });
  await pause(1500);
  assert(
    await b.evaluate(async () => {
      await Promise.race([
        window.consumer.ready,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('READY_TIMEOUT')), 10000),
        ),
      ]);
      return true;
    }),
  );
  assert.deepEqual(
    await b.evaluate(() => ({
      margin: getComputedStyle(document.body).margin,
      color: getComputedStyle(document.body).backgroundColor,
      header: getComputedStyle(document.querySelector('#host-header')).height,
    })),
    { margin: '11px', color: 'rgb(12, 34, 56)', header: '40px' },
  );
  await checkIds();
  await checkDownload(model);
  await checkDownload(model, 'second', 'en');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-node]').length,
    ),
    model.nodes.length,
  );
  assert(
    (
      await b.evaluate(
        () => document.querySelector('#first .brand').textContent,
      )
    ).includes(model.title),
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#second [data-control=contracts]').textContent,
    ),
    english.rulesButton,
  );
  const initial = await state();
  const other = await state('second');
  await focus('search');
  assert((await state()).visible.includes('engine'));
  await focus('engine');
  assert((await state()).visible.includes('ranking'));
  assert.deepEqual((await state()).nodeGeometry, initial.nodeGeometry);
  assert.deepEqual((await state('second')).viewport, other.viewport);
  await focus('ranking');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first .implementation').dataset.implemented,
    ),
    'false',
  );
  assert(
    (
      await b.evaluate(
        () => document.querySelector('#first .implementation').textContent,
      )
    ).includes(copy.implementationUnconfirmed),
  );
  await b.capture('consumer-details');

  await b.evaluate(() => document.querySelector('#host-input').focus());
  const before = (await state()).viewport;
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
  await pause(350);
  assert.deepEqual((await state()).viewport, before);
  await b.evaluate(() => document.querySelector('#first .map-app').focus());
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
  await pause(350);
  assert.equal((await state()).expanded.length, 0);
  assert.deepEqual((await state('second')).viewport, other.viewport);

  for (let i = 0; i < 12 && !(await state()).visible.includes('gateway'); i++) {
    const point = await b.evaluate(() => {
      const r = document
        .querySelector('#first [data-node=search]')
        .getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await b.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...point,
      deltaX: 0,
      deltaY: -160,
    });
    await pause(200);
  }
  assert((await state()).visible.includes('gateway'));
  await b.evaluate(() => window.consumer.first.home());
  await click('#first [data-node=search]', 2);
  assert((await state()).visible.includes('engine'));
  const interactions = (await state()).relations.length;
  await b.evaluate(() => {
    const select = document.querySelector('#first [data-control=layer]');
    select.value = 'data';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pause();
  assert.equal((await state()).relations.length, interactions);
  assert.equal((await state()).layer, 'data');
  assert.equal((await state('second')).layer, 'all');
  await click('#first [data-control=contracts]');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first .contract-list details').length,
    ),
    13,
  );
  await click('#first .contract-list summary');
  await b.capture('consumer-contract');

  const verified = structuredClone(model);
  for (const item of [
    verified.nodes[0],
    ...verified.relations.filter(
      (edge) => edge.from === model.entry || edge.to === model.entry,
    ),
  ])
    Object.assign(item, {
      implemented: true,
      implementationEvidence:
        'Fixture: complete entry path verified at a fixed revision.',
    });
  await load(verified);
  await focus(model.entry);
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first .implementation').dataset.implemented,
    ),
    'true',
  );
  await click('#first .implementation summary');
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first .implementation details').textContent,
      )
    ).includes(verified.nodes[0].implementationEvidence),
  );
  assert.equal((await state('second')).panel, null);

  const broken = structuredClone(model);
  broken.relations = broken.relations.filter(
    (edge) => edge.from !== 'publisher' && edge.to !== 'publisher',
  );
  const invalid = await b.evaluate(async (data) => {
    try {
      await window.consumer.first.load(data);
      return null;
    } catch (error) {
      return { code: error.code, issues: error.issues };
    }
  }, broken);
  assert.equal(invalid.code, 'INVALID_MODEL');
  assert(invalid.issues.includes('INTERACTION_REQUIRED:publisher'));
  await pause();
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-node]').length,
    ),
    0,
  );
  assert(
    (
      await b.evaluate(
        () => document.querySelector('#first [role=alert]').textContent,
      )
    ).includes(copy.errors.INTERACTION_REQUIRED.replace('{key}', 'publisher')),
  );
  await load(model);

  let pausedRequest;
  const intercept = b.on('Fetch.requestPaused', (event) => {
    pausedRequest = event.requestId;
  });
  await b.call('Fetch.enable', {
    patterns: [
      { urlPattern: '*slow-architecture.json', requestStage: 'Request' },
    ],
  });
  await b.evaluate(() => {
    window.staleOutcome = null;
    window.consumer.first
      .load(new URL('slow-architecture.json', document.baseURI))
      .then(
        () => {
          window.staleOutcome = 'resolved';
        },
        (error) => {
          window.staleOutcome = error.name;
        },
      );
  });
  for (let i = 0; i < 20 && !pausedRequest; i++) await pause(50);
  assert(pausedRequest);
  const replacement = structuredClone(model);
  replacement.title = 'Replacement <img src=x onerror=alert(1)>';
  await load(replacement);
  assert.equal(await b.evaluate(() => window.staleOutcome), 'AbortError');
  await b.call('Fetch.disable');
  intercept();
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first .brand img') !== null,
    ),
    false,
  );
  assert(
    (
      await b.evaluate(
        () => document.querySelector('#first .brand').textContent,
      )
    ).includes(replacement.title),
  );
  await checkDownload(replacement);

  await b.evaluate(async (data) => {
    await window.consumer.renderReact(data);
  }, model);
  assert.equal(
    await b.evaluate(
      () => window.consumer.reactRef.current.snapshot().visible.length,
    ),
    model.nodes.length,
  );
  const badReact = await b.evaluate(async (data) => {
    try {
      await window.consumer.renderReact(data);
      return null;
    } catch (error) {
      return error.code;
    }
  }, broken);
  assert.equal(badReact, 'INVALID_MODEL');
  await pause();
  assert.equal(await b.evaluate(() => window.consumer.reactRef.current), null);
  await b.evaluate(async (data) => {
    await window.consumer.renderReact(data);
  }, model);

  const destroyed = await b.evaluate(async (data) => {
    const c = window.consumer;
    const pending = c.second.load(data).then(
      () => 'resolved',
      (error) => error.name,
    );
    c.second.destroy();
    c.second.destroy();
    const outcome = await pending;
    c.second = c.mountArchitectureMap(document.querySelector('#second'), {
      source: data,
      locale: 'en',
    });
    await c.second.ready;
    let duplicate;
    try {
      c.mountArchitectureMap(document.querySelector('#second'), {
        source: data,
      });
    } catch (error) {
      duplicate = error.code;
    }
    return { outcome, duplicate };
  }, model);
  assert.deepEqual(destroyed, {
    outcome: 'AbortError',
    duplicate: 'CONTAINER_IN_USE',
  });
  await checkIds();
  await load(model);
  const deep = structuredClone(model);
  const engine = deep.nodes
    .find((node) => node.key === 'search')
    .children.find((node) => node.key === 'engine');
  let nested = engine.children.find((node) => node.key === 'ranking');
  for (let level = 0; level < 6; level++) {
    const siblings = Array.from({ length: 3 }, (_, index) => ({
      ...structuredClone(model.nodes[0]),
      key: 'sibling-' + level + '-' + index,
    }));
    for (const sibling of siblings)
      deep.relations.push({
        ...structuredClone(model.relations[0]),
        key: 'input-' + sibling.key,
        to: sibling.key,
      });
    nested = {
      ...structuredClone(engine),
      key: 'level-' + level,
      children: [nested, ...siblings],
    };
  }
  engine.children = [
    engine.children.find((node) => node.key === 'query'),
    nested,
  ];
  await load(deep);
  await focus('level-0');
  assert((await state()).viewport.zoom > 160);
  assert((await state()).visible.includes('ranking'));
  const deepBox = await b.evaluate(() =>
    document
      .querySelector('#first [data-node=ranking]')
      .getBoundingClientRect()
      .toJSON(),
  );
  assert(deepBox.width > 100 && deepBox.height > 60);
  await load(model);
  await b.capture('consumer-multiple');
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause();
  await focus('engine');
  assert((await state()).visible.includes('ranking'));
  assert.equal(
    await b.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await focus('ranking');
  await b.capture('consumer-mobile');
  assert.equal((await state()).layoutPasses, initial.layoutPasses);
  assert.deepEqual(b.errors, []);
  assert.equal(
    b.logs.filter((log) => ['error', 'warning'].includes(log.type)).length,
    0,
  );
  assert(
    b.requests
      .filter((url) => /^https?:/.test(url))
      .every((url) => url.startsWith('http://127.0.0.1:44891/')),
  );
  console.log(
    'PASS: installed package, independent maps, scoped CSS and keyboard, semantic zoom, file replacement, cancellation, failures, implementation evidence, StrictMode, destroy/remount, mobile, external resources.',
  );
} finally {
  b.close();
}
