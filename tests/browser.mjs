import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clicker, pause, settler, waiter } from './cdp.mjs';
import { startHarness } from './harness.mjs';
import { generateDocumentation } from '../src/node.mjs';
import { nodeAppearance } from '../src/model/appearance.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/architecture.json', import.meta.url),
    'utf8',
  ),
);
const nodesByKey = new Map();
(function collect(nodes) {
  for (const node of nodes) {
    nodesByKey.set(node.key, node);
    if (node.children) collect(node.children);
  }
})(model.nodes);
const copy = JSON.parse(
  await fs.readFile(new URL('../assets/strings.json', import.meta.url), 'utf8'),
);
const harness = await startHarness();
const b = harness.browser;
const state = (name = 'first') =>
  b.evaluate((name) => window.consumer[name].snapshot(), name);
const until = waiter(b);
const settled = settler(b);
const camera = () => window.consumer.first.snapshot().viewport;
const focus = async (key) => {
  await b.evaluate((key) => window.consumer.first.focus(key), key);
  await settled(camera);
};
const click = clicker(b);
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
const checkDownload = async (data, name = 'first') => {
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
  assert.equal(text, await generateDocumentation(data));
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
    url: harness.url,
  });
  await until(() => Boolean(window.consumer));
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
  await checkDownload(model, 'second');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-node]').length,
    ),
    model.nodes.length,
  );
  // A card is drawn from the shared appearance table, not from a palette this
  // surface keeps to itself: the zone it states is painted along the card's
  // edge in that zone's tone, and the kind decides the outline.
  const cards = await b.evaluate(() =>
    [...document.querySelectorAll('#first [data-node]')].map((card) => ({
      key: card.dataset.node,
      zone: card.dataset.zone,
      stripe: getComputedStyle(card).boxShadow,
      outline: getComputedStyle(card).borderTopStyle,
    })),
  );
  const rgb = (hex) =>
    'rgb(' +
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ') +
    ')';
  assert(cards.length, 'expected rendered cards');
  for (const card of cards) {
    const item = nodesByKey.get(card.key);
    const look = nodeAppearance(item);
    assert.equal(card.zone, item.zone, 'card ' + card.key + ' hides its zone');
    assert(
      card.stripe.includes(rgb(look.tone)),
      'card ' + card.key + ' does not paint its zone: ' + card.stripe,
    );
    assert.equal(
      card.outline,
      look.outline,
      'card ' + card.key + ' invents an outline',
    );
  }
  // A kind is a silhouette, not only a label: a store and an external
  // participant are told apart from a plain component at a glance, and the pill
  // is a pill however wide the card is.
  await focus('engine');
  const silhouettes = await b.evaluate(() =>
    [...document.querySelectorAll('#first [data-node]')].map((card) => ({
      kind: card.dataset.kind,
      radius: getComputedStyle(card).borderRadius,
      height: card.getBoundingClientRect().height,
      corner: parseFloat(getComputedStyle(card).borderTopLeftRadius),
    })),
  );
  const drawn = (kind) => silhouettes.filter((card) => card.kind === kind);
  for (const kind of ['component', 'store', 'external'])
    assert(drawn(kind).length, 'the fixture must render a ' + kind);
  const shapes = new Set(
    ['component', 'store', 'external'].map((kind) => drawn(kind)[0].radius),
  );
  assert.equal(shapes.size, 3, 'kinds share one silhouette');
  for (const pill of drawn('external'))
    assert(
      pill.corner >= pill.height / 2 - 1,
      'an external participant is not drawn as a pill',
    );
  await focus(model.entry);
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
    copy.rulesButton,
  );
  const initial = await state();
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll('#first [data-node] .node-implementation')
          .length,
    ),
    initial.visible.length,
  );
  assert(
    await b.evaluate(() =>
      [...document.querySelectorAll('#first [data-relation]')].every(
        (edge) =>
          edge.dataset.implemented === 'false' &&
          edge.querySelector('.edge-implementation'),
      ),
    ),
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector(
          '#second [data-control=implementation-legend] strong',
        ).textContent,
    ),
    copy.mapImplementation.label,
  );
  const other = await state('second');
  await focus('search');
  assert((await state()).visible.includes('engine'));
  await focus('engine');
  assert((await state()).visible.includes('ranking'));
  await b.evaluate(() => window.consumer.first.inspect('engine'));
  await until(() => window.consumer.first.snapshot().panel !== null);
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll(
          '#first [data-direction=incoming] [data-interface-group]',
        ).length,
    ),
    2,
  );
  await click('#first [data-direction=incoming] summary');
  assert.deepEqual(
    await b.evaluate(() =>
      [
        ...document.querySelectorAll(
          '#first [data-direction=incoming] [data-interface-group]:first-of-type [data-interface]',
        ),
      ].map((element) => element.dataset.interface),
    ),
    ['query-input', 'ranking-input'],
  );
  for (const key of ['query-input', 'ranking-input'])
    assert.equal(
      await b.evaluate(
        (key) =>
          document.querySelector(`#first [data-interface=${key}] p`)
            .textContent,
        key,
      ),
      model.relations.find((edge) => edge.key === key).payload,
    );
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
  // Nothing should happen, so a settled camera is the only available signal.
  await pause(350);
  assert.deepEqual((await state()).viewport, before);
  await b.evaluate(() => document.querySelector('#first .map-app').focus());
  await b.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home' });
  await until(() => window.consumer.first.snapshot().expanded.length === 0);
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
    await settled(camera);
  }
  assert((await state()).visible.includes('gateway'));
  await b.evaluate(() => window.consumer.first.home());
  await settled(camera);
  await click('#first [data-node=search]', 2);
  await until(() =>
    window.consumer.first.snapshot().visible.includes('engine'),
  );
  assert((await state()).visible.includes('engine'));
  const interactions = (await state()).relations.length;
  await b.evaluate(() => {
    const select = document.querySelector('#first [data-control=layer]');
    select.value = 'data';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(() => window.consumer.first.snapshot().layer === 'data');
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
      (edge) =>
        edge.from === model.entry ||
        edge.to === model.entry ||
        edge.key === 'query-input',
    ),
  ])
    Object.assign(item, {
      implemented: true,
      implementationEvidence:
        'Fixture: complete entry path verified at a fixed revision.',
    });
  await load(verified);
  await focus('search');
  const mixed = await state();
  const shared = mixed.relations.find((edge) =>
    edge.members.includes('query-input'),
  );
  assert.equal(shared.members.length, 2);
  assert.equal(shared.implemented, false);
  assert.equal(shared.state, 'partial');
  assert(
    await b.evaluate(
      () =>
        [...document.querySelectorAll('#first [data-node]')].some(
          (node) => node.dataset.implemented === 'true',
        ) &&
        [...document.querySelectorAll('#first [data-node]')].some(
          (node) => node.dataset.implemented === 'false',
        ),
    ),
  );
  await focus('engine');
  const detailed = await state();
  for (const relation of detailed.relations) {
    const expected = relation.members.every(
      (key) => verified.relations.find((edge) => edge.key === key).implemented,
    );
    assert.equal(relation.implemented, expected);
  }
  const rendered = await b.evaluate(() =>
    [...document.querySelectorAll('#first [data-relation]')].map((edge) => ({
      key: edge.dataset.relation,
      implemented: edge.dataset.implemented,
      mark: edge.querySelector('.implementation-mark').dataset.implemented,
    })),
  );
  for (const edge of rendered) {
    assert.equal(edge.mark, edge.implemented);
    if (edge.key.startsWith('query-input--'))
      assert.equal(edge.implemented, 'true');
    if (edge.key.startsWith('ranking-input--'))
      assert.equal(edge.implemented, 'false');
  }
  await b.capture('consumer-implementation-mixed');
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
  await until(
    () => document.querySelectorAll('#first [data-node]').length === 0,
  );
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
  await until(() => window.consumer.reactRef.current === null);
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
  await settled(camera);
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
      .every((url) => url.startsWith(harness.origin + '/')),
  );
  console.log(
    'PASS: installed package, independent maps, scoped CSS and keyboard, semantic zoom, file replacement, cancellation, failures, implementation evidence, StrictMode, destroy/remount, mobile, external resources.',
  );
} finally {
  await harness.stop();
}
