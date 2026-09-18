import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clicker, pause, settler, waiter } from './cdp.mjs';
import { startHarness } from './harness.mjs';
import { generateDocumentation } from '../src/node.mjs';
import { nodeAppearance } from '../src/model/appearance.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../models/rendering.json', import.meta.url),
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
  await fs.readFile(
    new URL('../assets/archivarius-strings.json', import.meta.url),
    'utf8',
  ),
);
const format = (template, values) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
const plural = (count) => new Intl.PluralRules(copy.locale).select(count);
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
// A real key, both halves of it, then two frames — the same signal `clicker`
// waits for, so no assertion below has to sleep for a render.
const keys = {
  Tab: { code: 'Tab', vk: 9 },
  Enter: { code: 'Enter', vk: 13 },
  Escape: { code: 'Escape', vk: 27 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
  End: { code: 'End', vk: 35 },
  Home: { code: 'Home', vk: 36 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
};
const press = async (key, modifiers = 0) => {
  const spec = keys[key];
  for (const type of ['keyDown', 'keyUp'])
    await b.call('Input.dispatchKeyEvent', {
      type,
      key,
      code: spec.code,
      text: spec.text || '',
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
      modifiers,
    });
  await b.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
};
const tab = (shift = false) => press('Tab', shift ? 8 : 0);
// Where the keyboard stands, named the way the ring audit names things.
const spot = () =>
  b.evaluate(() => {
    const element = document.activeElement;
    const holder = element?.closest(
      '[data-node],[data-relation],[data-control],[data-edge-label]',
    );
    const data = holder?.dataset || {};
    return data.node
      ? 'node:' + data.node
      : data.relation
        ? 'relation:' + data.relation
        : data.edgeLabel
          ? 'label:' + data.edgeLabel
          : data.control ||
            element?.getAttribute('class') ||
            element?.tagName.toLowerCase() ||
            null;
  });
// WCAG 2.4.3 / APG composite widget: whatever the map draws, Tab must reach it
// once. React Flow's own attribution link is the host page's, not the map's.
const tabStops = () =>
  b.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#first .map-pane :is([data-node],[data-relation],[data-edge-label])',
      ),
    ]
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .filter((element) => element.tabIndex === 0)
      .map(
        (element) =>
          element.dataset.node ||
          element.dataset.relation ||
          element.dataset.edgeLabel,
      ),
  );
// Reading order, taken off the screen rather than out of the DOM.
const readingOrder = () =>
  b.evaluate(() =>
    [...document.querySelectorAll('#first [data-node]')]
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .map((element) => ({
        key: element.dataset.node,
        rect: element.getBoundingClientRect(),
      }))
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
      .map((entry) => entry.key),
  );
// WCAG 4.1.3: one polite region for the whole surface, and what it currently says.
const announced = () =>
  b.evaluate(() => {
    const regions = [...document.querySelectorAll('#first [aria-live]')];
    return {
      count: regions.length,
      politeness: regions.map((region) => region.getAttribute('aria-live')),
      atomic: regions.map((region) => region.getAttribute('aria-atomic')),
      role: regions.map((region) => region.getAttribute('role')),
      text: regions.map((region) => region.textContent).join(''),
      clipped: regions.map((region) => {
        const rect = region.getBoundingClientRect();
        return rect.width <= 1 && rect.height <= 1;
      }),
    };
  });
const untilAnnounced = async (expected) => {
  await until(
    (expected) =>
      [...document.querySelectorAll('#first [aria-live]')]
        .map((region) => region.textContent)
        .join('') === expected,
    expected,
  ).catch(() => {});
  assert.equal((await announced()).text, expected);
};
const load = (data) =>
  b.evaluate(async (data) => {
    await window.consumer.first.load(
      new File([JSON.stringify(data)], 'architecture.json', {
        type: 'application/json',
      }),
    );
  }, data);
// A model the size `responsive-at-scale` budgets for, built rather than stored:
// the number of parts is the parameter under test, not a fixture to maintain.
const scaleModel = (groups, perGroup, fanOut) => {
  const zones = ['presentation', 'application', 'infrastructure', 'pure'];
  const nodes = [];
  const relations = [];
  for (let group = 0; group < groups; group++) {
    const children = [];
    for (let index = 0; index < perGroup; index++)
      children.push({
        key: 'part-' + group + '-' + index,
        title: 'Part ' + group + '.' + index,
        summary: 'A generated part of the scale model.',
        kind: 'component',
        zone: zones[(group + index) % zones.length],
        rules: [],
        detail: 'boundary',
        detailNote: 'Generated part, not expanded.',
        implemented: false,
      });
    for (let index = 0; index < perGroup; index++)
      for (let step = 1; step <= fanOut; step++)
        relations.push({
          key: 'call-' + group + '-' + index + '-' + step,
          from: 'part-' + group + '-' + index,
          to: 'part-' + group + '-' + ((index + step) % perGroup),
          kind: 'command',
          channel: 'generated',
          label: 'Call ' + step,
          payload: 'A generated payload.',
          meaning: 'A generated exchange of the scale model.',
          implemented: false,
        });
    if (group)
      relations.push({
        key: 'link-' + group,
        from: 'part-' + (group - 1) + '-0',
        to: 'part-' + group + '-0',
        kind: 'command',
        channel: 'generated',
        label: 'Link',
        payload: 'A generated payload.',
        meaning: 'A generated exchange of the scale model.',
        implemented: false,
      });
    nodes.push({
      key: 'group-' + group,
      title: 'Group ' + group,
      summary: 'A generated subsystem of the scale model.',
      kind: 'subsystem',
      zone: zones[group % zones.length],
      rules: [],
      detail: 'mapped',
      implemented: false,
      children,
    });
  }
  return {
    version: model.version,
    scope: model.scope,
    title: 'Scale model',
    entry: 'part-0-0',
    nodes,
    relations,
  };
};
const checkIds = async () => {
  const ids = await b.evaluate(() =>
    [...document.querySelectorAll('[id]')].map((e) => e.id),
  );
  assert.equal(new Set(ids).size, ids.length);
};
// WCAG 2.4.7 / 2.4.11 / 1.4.11: focus every element a keyboard can reach and
// read back the ring the surface draws for it — at least 2px, offset off the edge
// it shares, and still there under a forced palette.
const reach =
  '#first :is(button, input, select, summary, [tabindex]):not(:disabled)';
// `:focus-visible` only answers for a keyboard, so every sweep starts with a real
// Tab: after a click the same programmatic focus draws nothing.
const rings = async () => {
  await b.call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  });
  return b.evaluate((selector) => {
    const restore = document.activeElement;
    const found = [...document.querySelectorAll(selector)]
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .map((element) => {
        element.focus({ preventScroll: true });
        const style = getComputedStyle(element);
        return {
          name:
            element.dataset.control ||
            (element.dataset.node && 'node:' + element.dataset.node) ||
            (element.dataset.relation &&
              'relation:' + element.dataset.relation) ||
            element.getAttribute('class') ||
            element.tagName.toLowerCase(),
          focused: document.activeElement === element,
          visible: element.matches(':focus-visible'),
          thickness:
            style.outlineStyle === 'none' ? 0 : parseFloat(style.outlineWidth),
          offset: parseFloat(style.outlineOffset),
          color: style.outlineColor,
          shadow: style.boxShadow,
        };
      });
    restore?.focus?.({ preventScroll: true });
    return found;
  }, reach);
};
const audited = new Set();
const checkRings = (found, scheme) => {
  assert(found.length >= 8, scheme + ': too few focusable elements');
  for (const ring of found) {
    audited.add(ring.name);
    assert(ring.focused, scheme + ': ' + ring.name + ' cannot take focus');
    assert(ring.visible, scheme + ': ' + ring.name + ' misses :focus-visible');
    assert(
      ring.thickness >= 2 || ring.shadow !== 'none',
      scheme + ': ' + ring.name + ' has no ring ' + JSON.stringify(ring),
    );
    assert(
      ring.offset !== 0,
      scheme + ': ' + ring.name + ' draws its ring on a shared edge',
    );
  }
};
const media = (features) => b.call('Emulation.setEmulatedMedia', { features });
// Forced colours throw the author palette away, so the ring has to be restated
// with a system colour: read what `Highlight` resolves to and hold every ring to it.
const highlight = () =>
  b.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.outline = '3px solid Highlight';
    document.body.append(probe);
    const value = getComputedStyle(probe).outlineColor;
    probe.remove();
    return value;
  });
const auditRings = async (label) => {
  checkRings(await rings(), label + ' light');
  await media([{ name: 'prefers-color-scheme', value: 'dark' }]);
  checkRings(await rings(), label + ' dark');
  await media([{ name: 'forced-colors', value: 'active' }]);
  const forced = await rings();
  checkRings(forced, label + ' forced-colors');
  const system = await highlight();
  for (const ring of forced)
    assert.equal(
      ring.color,
      system,
      label + ': forced colours drop the ring on ' + ring.name,
    );
  await media([]);
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
  // is a pill however wide the card is. Read at home, where every part is inside
  // the viewport: zoomed into one part the map mounts only what the reader sees.
  await b.evaluate(() => window.consumer.first.home());
  await settled(camera);
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
          '#second [data-control=implementation-legend] summary',
        ).textContent,
    ),
    copy.mapImplementation.label,
  );
  const other = await state('second');
  await focus('search');
  assert((await state()).visible.includes('engine'));
  await focus('engine');
  assert((await state()).visible.includes('ranking'));
  // A reader who never touches the mouse must see where they are, whatever theme
  // the system forces on the page. Audit the map first: its chrome and its cards
  // step out of the keyboard's way once the inspector takes the narrow surface over.
  await auditRings('map');
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
  // Reach: the question a reader asks before changing anything. The selected block
  // is `engine`, whose leaves exchange with the gateway and the archive, so the
  // panel must report both directions, the loop those parts stand in, and the way
  // to a reached part once it is opened.
  assert.deepEqual(
    await b.evaluate(() => {
      const reach = document.querySelector('#first [data-control=reach]');
      const side = (which) =>
        [
          ...reach.querySelectorAll(`[data-reach-side=${which}] [data-reach]`),
        ].map((element) => element.dataset.reach);
      return {
        downstream: side('downstream'),
        upstream: side('upstream'),
        cycles: [...reach.querySelectorAll('[data-reach-cycle]')].map(
          (element) => element.dataset.reachCycle,
        ),
      };
    }),
    {
      downstream: ['archive', 'gateway', 'portal', 'publisher'],
      upstream: ['archive', 'gateway', 'portal', 'publisher'],
      cycles: ['archive gateway portal publisher query ranking'],
    },
  );
  await click(
    '#first [data-reach-side=downstream] [data-reach=publisher] summary',
  );
  await until(
    () => !!document.querySelector('#first [data-reach-path=publisher]'),
  );
  assert.deepEqual(
    await b.evaluate(() =>
      [
        ...document.querySelectorAll(
          '#first [data-reach-path=publisher] button',
        ),
      ].map((button) => button.textContent),
    ),
    // The way out starts at the member of the block that gets there first, not at
    // the block, because that is the way a change would actually travel.
    ['Candidate retrieval', 'Catalog index', 'Catalog provider'],
  );

  // Now the reading surface: the inspector, its close control and its disclosures.
  await auditRings('reading');
  // Together the two passes have to have covered every control the surface owns,
  // or the audit above proves nothing about the ones it never focused.
  assert.deepEqual(
    [
      'map-app',
      'map-pane',
      'inspector',
      'node-search',
      'layer',
      'contracts',
      'about',
      'clear-focus',
      'minus',
      'plus',
      'home',
      'close',
      'panel-button',
      'summary',
    ].filter((name) => !audited.has(name)),
    [],
  );
  for (const kind of ['node:', 'relation:'])
    assert(
      [...audited].some((name) => name.startsWith(kind)),
      'no ' + kind + ' element was ever focused',
    );
  // The keyboard also has to be able to jump between the two named regions the
  // surface is made of.
  assert.deepEqual(
    await b.evaluate(() => {
      const named = (element) =>
        element.getAttribute('aria-label') ||
        document.getElementById(element.getAttribute('aria-labelledby'))
          ?.textContent;
      return ['.map-pane', '[data-control=inspector]'].map((selector) => {
        const region = document.querySelector('#first ' + selector);
        return {
          role: region.getAttribute('role'),
          name: named(region),
          heading: region.querySelector('h2')?.textContent,
        };
      });
    }),
    [
      {
        role: 'region',
        name: copy.mapRegionLabel,
        heading: copy.mapRegionLabel,
      },
      {
        role: 'region',
        name: copy.inspectorLabel,
        heading: nodesByKey.get('engine').title,
      },
    ],
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

  // WCAG 4.1.3: a change the reader did not type is spoken once, by the one
  // polite region the surface owns. Loading a model is such a change.
  await load(model);
  await untilAnnounced(
    format(copy.announcements.loaded[plural(nodesByKey.size)], {
      title: model.title,
      count: nodesByKey.size,
    }),
  );
  assert.deepEqual(await announced(), {
    count: 1,
    politeness: ['polite'],
    atomic: ['true'],
    role: ['status'],
    text: format(copy.announcements.loaded[plural(nodesByKey.size)], {
      title: model.title,
      count: nodesByKey.size,
    }),
    // Spoken, never drawn: the map already says this on screen.
    clipped: [true],
  });
  // APG composite widget: the whole map is one tab stop, and the arrows walk the
  // level the reader stands in. Nothing here is reachable by pointer only.
  const overview = await readingOrder();
  assert.deepEqual(
    [...overview].sort(),
    model.nodes.map((node) => node.key).sort(),
  );
  assert.deepEqual(await tabStops(), [overview[0]]);
  await b.evaluate(() =>
    document.querySelector('#first [data-control=about]').focus(),
  );
  await tab();
  assert.equal(await spot(), 'node:' + overview[0]);
  await tab();
  assert.doesNotMatch(await spot(), /^(?:node|relation|label):/);
  await tab(true);
  assert.equal(await spot(), 'node:' + overview[0]);
  await press('ArrowRight');
  assert.equal(await spot(), 'node:' + overview[1]);
  assert.deepEqual(await tabStops(), [overview[1]]);
  await press('ArrowDown');
  assert.equal(await spot(), 'node:' + overview[2]);
  await press('ArrowUp');
  await press('ArrowLeft');
  assert.equal(await spot(), 'node:' + overview[0]);
  await press('ArrowLeft');
  assert.equal(await spot(), 'node:' + overview[0]);
  // The arrows reach the relations of the level too, and End is its far end.
  await press('End');
  assert.match(await spot(), /^relation:/);
  await press('Home');
  assert.equal(await spot(), 'node:' + overview[0]);

  // Enter on a container is the keyboard's double-click: it enters the block and
  // leaves the reader standing inside it, on the level that is now current.
  const container = overview.find((key) => nodesByKey.get(key).children);
  for (let i = 0; i < overview.length; i++) {
    if ((await spot()) === 'node:' + container) break;
    await press('ArrowRight');
  }
  assert.equal(await spot(), 'node:' + container);
  assert.equal(
    await b.evaluate(
      (key) =>
        document
          .querySelector('#first [data-node="' + key + '"]')
          .getAttribute('aria-expanded'),
      container,
    ),
    'false',
  );
  await press('Enter');
  await until(
    (key) => window.consumer.first.snapshot().expanded.includes(key),
    container,
  );
  await untilAnnounced(
    format(copy.announcements.level, {
      level: nodesByKey.get(container).title,
    }),
  );
  const children = nodesByKey.get(container).children.map((node) => node.key);
  // Expanding moves the spot inside; the move lands on a frame of its own, so it
  // is waited for rather than read the instant the announcement arrives.
  await until(
    (keys) =>
      keys.includes(
        document.activeElement?.closest('[data-node]')?.dataset.node,
      ),
    children,
  ).catch(() => {});
  assert(children.includes((await spot()).slice(5)), await spot());
  const insideOrder = await readingOrder();
  for (const key of children) assert(insideOrder.includes(key), key);
  await press('End');
  await press('Home');
  const inner = (await spot()).slice(5);
  assert(children.includes(inner), inner);
  assert((await state()).expanded.includes(container));

  // Enter on a block that has no inside opens its details, exactly as one click
  // does, and the region says what the panel now shows.
  const leaf = children.find((key) => !nodesByKey.get(key).children);
  for (let i = 0; i < children.length; i++) {
    if ((await spot()) === 'node:' + leaf) break;
    await press('ArrowRight');
  }
  assert.equal(await spot(), 'node:' + leaf);
  await press('Enter');
  await until(() => window.consumer.first.snapshot().panel === 'node');
  await untilAnnounced(
    format(copy.announcements.selected, { name: nodesByKey.get(leaf).title }),
  );
  assert.equal(await spot(), 'inspector');
  // Escape closes the details and gives the block back the focus it took.
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  assert.equal(await spot(), 'node:' + leaf);
  // Escape again leaves the container, and the reader lands on the block left.
  await press('Escape');
  await until(
    (key) => !window.consumer.first.snapshot().expanded.includes(key),
    container,
  );
  assert.equal(await spot(), 'node:' + container);
  await untilAnnounced(
    format(copy.announcements.level, { level: copy.wholeSystem }),
  );

  // An arrow answers to the keyboard the way it answers to a click.
  await press('End');
  const edge = (await spot()).slice('relation:'.length);
  const ends = edge.split('--').slice(-2);
  await press('Enter');
  await until(() => window.consumer.first.snapshot().panel === 'relation');
  await untilAnnounced(
    format(copy.announcements.selected, {
      name: ends.map((key) => nodesByKey.get(key).title).join(' → '),
    }),
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-control=inspector] h2')
          .textContent,
    ),
    ends.map((key) => nodesByKey.get(key).title).join(' → '),
  );
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  assert.equal(await spot(), 'relation:' + edge);
  // Space is the other half of a single click: details without entering.
  await press('Home');
  assert.equal(await spot(), 'node:' + overview[0]);
  await press(' ');
  await until(() => window.consumer.first.snapshot().panel === 'node');
  await untilAnnounced(
    format(copy.announcements.selected, {
      name: nodesByKey.get(overview[0]).title,
    }),
  );
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);

  // Two levels of detail, checked on the drawing: nothing informational is open
  // until a reader opens it, opening one writes it into the address so a link
  // restores the same reading, and Escape gives back what the reader opened —
  // the panel first, the surfaces after it.
  const chrome = () =>
    b.evaluate(() =>
      [...document.querySelectorAll('#first details[data-control]')]
        .filter((d) => d.open)
        .map((d) => d.dataset.control),
    );
  const opened = (control) =>
    b.evaluate(
      (control) =>
        document.querySelector('#first [data-control=' + control + ']').open,
      control,
    );
  assert.deepEqual(await chrome(), [], 'the first screen opens a surface');
  await click('#first [data-control=appearance-legend] > summary');
  await until(
    () =>
      document.querySelector('#first [data-control=appearance-legend]').open,
  );
  assert.deepEqual(await chrome(), ['appearance-legend']);
  await until(() => location.search.includes('open=reading'));
  await press('Escape');
  await until(
    () =>
      !document.querySelector('#first [data-control=appearance-legend]').open,
  );
  await until(() => !location.search.includes('open='));

  // A part's exchanges are a surface like any other: it waits to be opened, and
  // the panel over the drawing is given back before it is.
  await b.evaluate(() => window.consumer.first.inspect('engine'));
  await until(() => window.consumer.first.snapshot().panel === 'node');
  assert.deepEqual(await chrome(), [], 'selecting a part opens a surface');
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  await click('#first [data-control=neighbours] > summary');
  await until(
    () => document.querySelector('#first [data-control=neighbours]').open,
  );
  await b.evaluate(() => window.consumer.first.inspect('engine'));
  await until(() => window.consumer.first.snapshot().panel === 'node');
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  assert.equal(
    await opened('neighbours'),
    true,
    'one Escape took the panel and the surface at once',
  );
  await press('Escape');
  await until(
    () => !document.querySelector('#first [data-control=neighbours]').open,
  );
  assert.deepEqual(await chrome(), []);

  await b.evaluate(() => window.consumer.first.home());
  await settled(camera);
  await checkIds();

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

  // Filters narrow the interactions inside a bundle before its label, count,
  // handles and keyboard ring are built.
  const filteredModel = structuredClone(model);
  filteredModel.relations.unshift({
    ...filteredModel.relations.find((edge) => edge.key === 'publish'),
    key: 'publish-command',
    kind: 'command',
    channel: 'publish-command',
    label: 'Start publication',
  });
  await load(filteredModel);
  await b.evaluate(() => {
    const select = document.querySelector(
      '#first [data-control=filter-relation]',
    );
    select.value = 'data';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(() =>
    Boolean(
      document.querySelector(
        '#first [data-relation="publish--publisher--archive"]',
      ),
    ),
  );
  const filteredEdges = await b.evaluate(() =>
    [...document.querySelectorAll('#first [data-relation]')].map(
      (edge) => edge.querySelector('title').textContent,
    ),
  );
  assert(
    filteredEdges.every((text) => !text.includes('Command')),
    filteredEdges.join('\n'),
  );
  assert(filteredEdges.some((text) => text.includes('1 source interaction')));
  await b.evaluate(() =>
    document
      .querySelector('#first [data-relation="publish--publisher--archive"]')
      .focus(),
  );
  await press('Enter');
  assert.equal(
    await b.evaluate(() =>
      document
        .querySelector('#first [data-control=inspector]')
        .textContent.includes('Start publication'),
    ),
    false,
  );
  await press('Escape');
  await b.evaluate(() => {
    const relation = document.querySelector(
      '#first [data-control=filter-relation]',
    );
    relation.value = 'all';
    relation.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(
    () =>
      document.querySelector('#first [data-control=filter-relation]').value ===
      'all',
  );
  await b.evaluate(() => {
    const select = document.querySelector('#first [data-control=filter-kind]');
    select.value = 'store';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(
    () => document.querySelector('#first [data-node=archive]')?.tabIndex === 0,
  );
  assert.deepEqual((await state()).visible, ['archive']);
  assert.deepEqual(await tabStops(), ['archive']);
  await b.evaluate(() =>
    document.querySelector('#first [data-control=about]').focus(),
  );
  await tab();
  assert.equal(await spot(), 'node:archive');
  await press(' ');
  assert.equal((await state()).panel, 'node');
  await press('Escape');
  await b.evaluate(() => {
    const select = document.querySelector('#first [data-control=filter-kind]');
    select.value = 'subsystem';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(
    () =>
      document.querySelector('#first [data-control=filter-kind]').value ===
      'subsystem',
  );
  await focus('engine');
  assert.deepEqual(await tabStops(), ['engine']);

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
  // Read at home: the map draws what is verified and what is not, and only the
  // parts inside the viewport are in the document.
  await b.evaluate(() => window.consumer.first.home());
  await settled(camera);
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
  // A failure is a change too, and it reaches the same polite region: the alert
  // that replaces the map is not the only way to hear that the load failed.
  await untilAnnounced(
    format(copy.announcements.failure, { code: copy.errors.INVALID_MODEL }),
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

  // `responsive-at-scale` budgets 500 parts: laying them out is seconds of work,
  // so it has to happen off the main thread or the page stops answering.
  const scale = scaleModel(10, 50, 8);
  await b.evaluate(() => {
    const real = window.Worker;
    window.work = { urls: [], live: 0, stopped: 0 };
    window.Worker = class extends real {
      constructor(url, options) {
        super(url, options);
        window.work.urls.push(String(url));
        window.work.live++;
      }
      terminate() {
        window.work.live--;
        window.work.stopped++;
        super.terminate();
      }
    };
  });
  // A self-rescheduling timer is the main thread's own pulse: the longest gap
  // between two beats is how long the page was unable to answer a user.
  const beating = () =>
    b.evaluate(() => {
      window.beat = { max: 0, beats: 0, last: performance.now() };
      const step = () => {
        const now = performance.now();
        window.beat.max = Math.max(window.beat.max, now - window.beat.last);
        window.beat.last = now;
        window.beat.beats++;
        if (!window.beat.stop) setTimeout(step, 0);
      };
      step();
    });
  const beaten = () =>
    b.evaluate(() => {
      window.beat.stop = true;
      return { max: Math.round(window.beat.max), beats: window.beat.beats };
    });
  await beating();
  await load(scale);
  const beat = await beaten();
  const work = await b.evaluate(() => window.work);
  assert.equal((await state()).visible.length, scale.nodes.length);
  assert(
    work.urls.some((url) => /layout-worker/.test(url)),
    'no layout worker: ' + JSON.stringify(work.urls),
  );
  assert.equal(work.live, 0);
  assert(beat.max < 250, 'main thread blocked for ' + beat.max + 'ms');

  // A superseded layout never lands: the newest model wins, the withdrawn one
  // reports itself, and its worker is stopped rather than left running.
  const spent = work.stopped;
  const race = await b.evaluate(
    async (first, second) => {
      const file = (data) =>
        new File([JSON.stringify(data)], 'architecture.json', {
          type: 'application/json',
        });
      const started = window.work.urls.length;
      const withdrawn = window.consumer.first.load(file(first)).then(
        () => 'resolved',
        (error) => error.name + ':' + error.message,
      );
      // Supersede a layout that is really running: a request replaced before its
      // worker exists proves nothing about stopping one.
      const deadline = performance.now() + 10000;
      while (window.work.urls.length === started) {
        if (performance.now() > deadline) return { withdrawn: 'never started' };
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const winner = window.consumer.first.load(file(second)).then(
        () => 'resolved',
        (error) => error.name + ':' + error.message,
      );
      return { withdrawn: await withdrawn, winner: await winner };
    },
    scaleModel(10, 50, 7),
    model,
  );
  assert.deepEqual(race, {
    withdrawn: 'AbortError:LOAD_SUPERSEDED',
    winner: 'resolved',
  });
  assert.equal((await state()).visible.length, model.nodes.length);
  assert.equal(await b.evaluate(() => window.work.live), 0);
  assert(await b.evaluate((spent) => window.work.stopped > spent, spent));

  // Geometry already computed is kept, so going back to a laid-out model needs no
  // worker at all and the map is never blank while it returns.
  const spawned = await b.evaluate(() => window.work.urls.length);
  await beating();
  await load(scale);
  const again = await beaten();
  assert.equal((await state()).visible.length, scale.nodes.length);
  assert.equal(await b.evaluate(() => window.work.urls.length), spawned);
  assert(again.max < 250, 'main thread blocked for ' + again.max + 'ms');
  await load(model);
  await b.evaluate(() => {
    window.Worker = Object.getPrototypeOf(window.Worker);
  });

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
