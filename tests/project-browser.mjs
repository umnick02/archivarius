import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { clicker, settler, waiter } from './cdp.mjs';
import { startHarness } from './harness.mjs';
import { analyzeProject } from '../src/model/project-analysis.mjs';
import { contractDigest } from '../src/model/project-digest.mjs';
import { digest, hashBytes } from '../src/model/digest.mjs';
import { executeProjectCheck } from '../src/node.mjs';

const project = JSON.parse(
  await fs.readFile(
    new URL('../models/documentation.json', import.meta.url),
    'utf8',
  ),
);
const copy = JSON.parse(
  await fs.readFile(
    new URL('../assets/archivarius-project-strings.json', import.meta.url),
    'utf8',
  ),
);
const harness = await startHarness();
const b = harness.browser;
const evidenceDirectory = new URL(
  '../.runtime/consumer/dist/implementation-fixture/',
  import.meta.url,
);
const click = clicker(b);
const until = waiter(b);
const settled = settler(b);
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
  await b.evaluate(async () => {
    await window.consumer.ready;
    await window.consumer.first.load(
      new URL('./project.json', document.baseURI),
    );
  });
  // A project opens on the diagram, whose facts use verified analysis, not a
  // prose-only project page. Following its task must keep the drawing present.
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first .map-app').dataset.workspace,
    ),
    'false',
  );
  assert(
    await b.evaluate(
      () => !!document.querySelector('#first [data-node=screen] meter'),
    ),
  );
  await b.evaluate(() => {
    document.querySelector('#maps').style.gridTemplateColumns = '1fr';
  });
  await until(() => document.querySelector('#first').clientWidth > 1000);
  await settled(() => window.consumer.first.snapshot().viewport);
  // Zoom has meaningful destinations: one wheel action frames the pointed leaf,
  // further input stops there, and one outward action returns to the overview.
  // At every destination, card facts are either compact or complete.
  for (const [width, height, font] of [
    [1440, 1000, 16],
    [390, 844, 16],
    [1440, 1000, 32],
  ]) {
    await b.call('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 500,
    });
    await b.evaluate(async (font) => {
      document.documentElement.style.fontSize = font + 'px';
      await window.consumer.first.home();
    }, font);
    await settled(() => window.consumer.first.snapshot().viewport);
    const overview = await b.evaluate(
      () => window.consumer.first.snapshot().viewport,
    );
    const wheel = async (deltaY) => {
      const point = await b.evaluate(() => {
        const r = document
          .querySelector('#first [data-node=screen]')
          .getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await b.call('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        ...point,
        deltaX: 0,
        deltaY,
      });
      await settled(() => window.consumer.first.snapshot().viewport);
    };
    const facts = async () => {
      const picture = await b.evaluate(() => {
        const card = document.querySelector('#first [data-node=screen]');
        const visible = (element) =>
          !!element?.getBoundingClientRect().width &&
          !!element?.getBoundingClientRect().height;
        return {
          facts: [
            '.eyebrow',
            '.node-implementation > span',
            'meter',
            '.signal-badges',
          ].map((selector) => visible(card.querySelector(selector))),
          parentFacts: document.querySelectorAll(
            '#first .node-card.expanded .project-signals',
          ).length,
        };
      });
      const count = picture.facts.filter(Boolean).length;
      assert(
        count === 0 || count === 4,
        'partial card: ' + JSON.stringify({ width, font, picture }),
      );
      assert.equal(picture.parentFacts, 0);
      return count;
    };
    await facts();
    await wheel(-100);
    const detail = await b.evaluate(
      () => window.consumer.first.snapshot().viewport,
    );
    assert(
      detail.zoom >= overview.zoom,
      'zoom in must not shrink an already readable leaf',
    );
    assert.equal(
      await facts(),
      4,
      'the final leaf stop must show its facts: ' +
        JSON.stringify({ width, font, overview, detail }),
    );
    for (let step = 0; step < 3; step++) await wheel(-100);
    await click('#first [data-control=plus]');
    await settled(() => window.consumer.first.snapshot().viewport);
    assert.deepEqual(
      await b.evaluate(() => window.consumer.first.snapshot().viewport),
      detail,
      'a leaf must not create more zoom states',
    );
    await wheel(100);
    assert.deepEqual(
      await b.evaluate(() => window.consumer.first.snapshot().viewport),
      overview,
      'one outward gesture returns to the overview',
    );
    await wheel(100);
    await click('#first [data-control=minus]');
    await settled(() => window.consumer.first.snapshot().viewport);
    assert.deepEqual(
      await b.evaluate(() => window.consumer.first.snapshot().viewport),
      overview,
      'zoom out must stop at the overview',
    );
    await facts();
  }
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await b.evaluate(() => window.consumer.first.focus('writer'));
  await settled(() => window.consumer.first.snapshot().viewport);
  assert(
    await b.evaluate(
      () => !!document.querySelector('#first [data-node-facts=writer]'),
    ),
  );
  const signals = await b.evaluate(() => {
    const card = document.querySelector('#first [data-node-facts=writer]');
    return {
      text: card.innerText,
      tasks: card.querySelector('[data-signal=tasks]')?.textContent,
      legend: !!document.querySelector(
        '#first [data-control=appearance-legend]',
      ),
    };
  });
  assert.match(signals.tasks, /\d+ tasks? to confirm/);
  assert(signals.text.includes(copy.diagram.criteria));
  assert.equal(signals.legend, false);
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-disclosure=record]').open,
    ),
    false,
  );
  await click('#first [data-node-task=implement-export]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first .map-app').dataset.workspace,
    ),
    'false',
  );
  assert.equal(
    await b.evaluate(
      () =>
        getComputedStyle(document.querySelector('#first .map-pane')).visibility,
    ),
    'visible',
  );
  await click('#first [data-control=record-back]');
  assert(
    await b.evaluate(
      () => !!document.querySelector('#first [data-node-facts=writer]'),
    ),
  );
  await b.evaluate(() => {
    document.querySelector('#maps').style.gridTemplateColumns = '';
  });
  await until(() => document.querySelector('#first').clientWidth < 780);
  await settled(() => window.consumer.first.snapshot().viewport);
  await b.evaluate(() => window.consumer.first.home());
  await click('#first [data-control=project]');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-project-view]').length,
    ),
    6,
  );
  assert.equal(
    await b.evaluate(() => document.activeElement.dataset.control),
    'inspector',
  );
  await click('#first [data-project-view=all]');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-record]').length,
    ),
    project.records.length,
  );
  await b.evaluate(() => {
    const select = document.querySelector('#first [data-control=record-type]');
    select.value = 'requirement';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(
    () => document.querySelectorAll('#first [data-record]').length === 3,
  );
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-record]').length,
    ),
    3,
  );
  await click('#first [data-record=exclude-private]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-record-title]').textContent,
    ),
    project.records.find((r) => r.key === 'exclude-private').title,
  );
  await click('#first .project-reasons summary');
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first [data-control=inspector]').textContent,
      )
    ).includes(copy.reasonsByCode.REQUIREMENT_UNMAPPED),
  );
  await click('#first [data-control=record-back]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=record-type]').value,
    ),
    'requirement',
  );
  await b.evaluate(() => window.consumer.first.inspect('implement-export'));
  await until(
    () =>
      document.querySelector('#first [data-record-title]')?.dataset
        .recordTitle === 'implement-export',
  );
  await click('#first [data-record-link=within-limit]');
  await click('#first [data-record-link=row-limit]');
  const order = await b.evaluate(() => {
    const panel = document.querySelector('#first [data-control=inspector]');
    return ['rule', 'parameters']
      .map(
        (field) =>
          panel.querySelector(`[data-field=${field}]`).getBoundingClientRect()
            .top,
      )
      .concat(
        panel.querySelector('.implementation').getBoundingClientRect().top,
      );
  });
  assert(order[0] < order[1] && order[1] < order[2]);
  await click('#first [data-control=record-back]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'within-limit',
  );
  await click('#first [data-record-link=row-limit]');
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first [data-control=inspector]').textContent,
      )
    ).includes('1000'),
  );
  await b.capture('project-requirement');
  if (
    !(await b.evaluate(
      () => document.querySelector('#first .project-reasons').open,
    ))
  )
    await click('#first .project-reasons > summary');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first .reason-group').length,
    ),
    2,
  );
  await click('#first .reason-group > summary');
  await click('#first .reason-group .record-link');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'export-check',
  );
  const before = await b.evaluate(() => window.consumer.first.snapshot());
  await b.evaluate(() => window.consumer.first.inspect('streaming'));
  const after = await b.evaluate(() => window.consumer.first.snapshot());
  assert.deepEqual(after.nodeGeometry, before.nodeGeometry);
  assert.deepEqual(after.viewport, before.viewport);
  await b.evaluate(() => window.consumer.first.focus('writer'));
  await settled(() => window.consumer.first.snapshot().viewport);
  // The diagram's short inspector defers the complete record explicitly.
  await click('#first [data-disclosure=record] > summary');
  await click('#first [data-disclosure=links-decision] > summary');
  await click('#first .project-links [data-record-link=streaming]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'streaming',
  );
  // Meaning and relationships are visible; receipts and definition history have
  // separate named disclosures. No panel prints a serialized record.
  const panelReading = await b.evaluate(() => {
    const panel = document.querySelector('#first [data-control=inspector]');
    const deferred = (selector) =>
      [...panel.querySelectorAll(selector)].length > 0 &&
      [...panel.querySelectorAll(selector)].every((element) =>
        element.closest(
          '[data-disclosure=technical], [data-disclosure=history]',
        ),
      );
    return {
      title: panel.querySelector('[data-record-title]')?.dataset.recordTitle,
      answered: panel.querySelectorAll('.record-primary .record-field').length,
      disclosures: panel.querySelectorAll('[data-disclosure=more]').length,
      basisDeferred: deferred('.record-technical'),
      linksVisible: !panel.querySelector('.project-links').closest('details'),
      historyDeferred: [...panel.querySelectorAll('.record-history')].every(
        (element) => element.matches('details:not([open])'),
      ),
      unnamed: [...panel.querySelectorAll('.record-field > h3')].filter((h) =>
        /^[a-z][A-Za-z]*$/.test(h.textContent.trim()),
      ).length,
      serialized: [...panel.querySelectorAll('pre')].filter((pre) =>
        /^\s*[[{]/.test(pre.textContent),
      ).length,
    };
  });
  assert.equal(panelReading.title, 'streaming');
  assert(panelReading.answered > 0, 'the first screen answers nothing');
  assert.equal(panelReading.disclosures, 1, 'the panel defers past one level');
  assert(panelReading.basisDeferred, 'the basis sits on the first screen');
  assert(
    panelReading.linksVisible,
    'related records are hidden behind technical details',
  );
  assert(
    panelReading.historyDeferred,
    'definition comparisons must be in history',
  );
  assert.equal(panelReading.unnamed, 0, 'a field reached the reader as a key');
  assert.equal(panelReading.serialized, 0, 'the panel printed a record');

  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await until(() =>
    Boolean(document.querySelector('#first [data-control=project]')),
  );
  await click('#first [data-control=project]');
  await click('#first [data-project-view=work]');
  await click('#first [data-record=implement-export]');
  assert(
    await b.evaluate(() => {
      const panel = document.querySelector('#first [data-control=inspector]');
      return (
        panel.clientWidth >= 300 && panel.scrollWidth === panel.clientWidth
      );
    }),
  );
  await b.capture('project-mobile');
  await b.evaluate(() => window.consumer.first.focus('writer'));
  await settled(() => window.consumer.first.snapshot().viewport);
  const mobileBefore = await b.evaluate(() => window.consumer.first.snapshot());
  const cardScroll = await b.evaluate(() => {
    const panel = document.querySelector('#first [data-control=inspector]');
    panel.scrollTop = 160;
    return panel.scrollTop;
  });
  await click('#first [data-control=mobile-map]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=inspector]').hidden,
    ),
    true,
  );
  await click('#first [data-control=mobile-card]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=inspector]').hidden,
    ),
    false,
  );
  assert.deepEqual(
    (await b.evaluate(() => window.consumer.first.snapshot())).viewport,
    mobileBefore.viewport,
  );
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=inspector]').scrollTop,
    ),
    cardScroll,
  );
  await click('#first [data-control=map-options] > summary');
  await click('#first [data-control=about]');
  assert(
    await b.evaluate(
      () => !!document.querySelector('#first [data-control=download-docs]'),
    ),
  );
  const malicious = structuredClone(project);
  malicious.records.find((r) => r.key === 'row-limit').rule =
    '<img src=x onerror=alert(1)>';
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    window.consumer.first.inspect('row-limit');
  }, malicious);
  await until(
    () =>
      document.querySelector('#first [data-record-title]')?.dataset
        .recordTitle === 'row-limit',
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll('#first [data-control=inspector] img').length,
    ),
    0,
  );
  // A shared record link must keep both the map selection and the independent
  // inspector record. Restore under a fresh mount name, as a receiver would.
  await b.evaluate((model) => window.consumer.first.load(model), project);
  for (const key of ['exclude-private', 'implement-export', 'streaming']) {
    await b.evaluate((key) => {
      window.consumer.first.inspect('writer');
      window.consumer.first.inspect(key);
    }, key);
    await until(
      (key) => new URLSearchParams(location.search).get('first.record') === key,
      key,
    );
    const restored = await b.evaluate(
      async (model, key) => {
        const name = 'linked-' + key;
        const search = new URLSearchParams(location.search);
        for (const [field, value] of [...search])
          if (field.startsWith('first.'))
            search.set(name + field.slice(5), value);
        history.replaceState(
          history.state,
          '',
          location.pathname + '?' + search,
        );
        const container = document.createElement('div');
        container.id = name;
        container.style.cssText = 'width:1200px;height:900px';
        document.body.append(container);
        const map = window.consumer.mountArchitectureMap(container, {
          source: model,
        });
        try {
          await map.ready;
          return {
            record: container.querySelector('[data-record-title]')?.dataset
              .recordTitle,
            selected: search.get(name + '.at'),
            errors: container.querySelector('[role=alert]')?.textContent,
          };
        } finally {
          map.destroy();
          container.remove();
        }
      },
      project,
      key,
    );
    assert.equal(restored.record, key, JSON.stringify(restored));
    assert.equal(restored.selected, 'writer');
    assert.equal(restored.errors, undefined);
  }

  const restoredWorkspace = await b.evaluate(async (model) => {
    const container = document.createElement('div');
    container.id = 'linked-plan';
    container.style.cssText = 'width:1200px;height:900px';
    document.body.append(container);
    const search = new URLSearchParams(location.search);
    for (const [key, value] of Object.entries({
      panel: 'project',
      view: 'all',
      query: '1000',
      recordType: 'requirement',
    }))
      search.set('linked-plan.' + key, value);
    history.replaceState(history.state, '', location.pathname + '?' + search);
    const map = window.consumer.mountArchitectureMap(container, {
      source: model,
    });
    try {
      await map.ready;
      return {
        workspace: container.querySelector('.map-app').dataset.workspace,
        query: container.querySelector('[data-control=record-search]').value,
        filter: container.querySelector('[data-control=record-type]').value,
        records: [...container.querySelectorAll('[data-record]')].map(
          (r) => r.dataset.record,
        ),
      };
    } finally {
      map.destroy();
      container.remove();
    }
  }, project);
  assert.deepEqual(restoredWorkspace, {
    workspace: 'true',
    query: '1000',
    filter: 'requirement',
    records: ['row-limit'],
  });

  assert.deepEqual(b.errors, []);
  // Use the full host width to exercise docking independently of the small
  // embedded-container presentation used above.
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.evaluate(async () => {
    document.querySelector('#maps').style.gridTemplateColumns = '1fr';
    document.querySelector('#second').style.display = 'none';
    await window.consumer.first.load(
      new URL('./project.json', document.baseURI),
    );
  });
  await click('#first [data-control=project]');
  assert(
    await b.evaluate(() => {
      const pane = document
        .querySelector('#first .map-pane')
        .getBoundingClientRect();
      const panel = document
        .querySelector('#first [data-control=inspector]')
        .getBoundingClientRect();
      return (
        panel.width >= pane.width &&
        getComputedStyle(document.querySelector('#first .map-pane'))
          .visibility === 'hidden'
      );
    }),
  );
  await b.capture('project-overview-desktop');
  await click('#first [data-control=record-search]');
  await b.call('Input.insertText', { text: '1000' });
  await until(
    () => document.querySelectorAll('#first [data-record]').length === 1,
  );
  assert.equal(
    await b.evaluate(() => document.activeElement.dataset.control),
    'record-search',
  );
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-record]').length,
    ),
    1,
  );
  await click('#first [data-record=row-limit]');
  await b.capture('project-requirement-desktop');
  await click('#first [data-control=record-back]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=record-search]').value,
    ),
    '1000',
  );
  await b.evaluate(() => {
    const input = document.querySelector('#first [data-control=record-search]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await until(() =>
    Boolean(document.querySelector('#first [data-record=implement-export]')),
  );
  await b.evaluate(() =>
    document
      .querySelector('#first [data-record=implement-export]')
      .scrollIntoView({ block: 'center' }),
  );
  const scrollBefore = await b.evaluate(
    () => document.querySelector('#first [data-control=inspector]').scrollTop,
  );
  assert(scrollBefore > 0);
  await click('#first [data-record=implement-export]');
  await click('#first [data-control=record-back]');
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first [data-control=inspector]').scrollTop,
    ),
    scrollBefore,
  );
  await b.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'F6',
    code: 'F6',
  });
  assert.equal(
    await b.evaluate(() => document.activeElement.dataset.control),
    'inspector',
  );
  await b.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'F6',
    code: 'F6',
  });
  assert.equal(
    await b.evaluate(() => document.activeElement.dataset.control),
    'record-search',
  );
  await b.evaluate(() => window.consumer.first.focus('writer'));
  const focused = await b.evaluate(() => window.consumer.first.snapshot());
  assert(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-muted=true]').length > 0,
    ),
  );
  assert(
    await b.evaluate(
      () => !!document.querySelector('#first [data-external-node=screen]'),
    ),
  );
  await click('#first [data-control=clear-focus]');
  const cleared = await b.evaluate(() => window.consumer.first.snapshot());
  assert.deepEqual(focused.nodeGeometry, cleared.nodeGeometry);
  assert.deepEqual(focused.relations, cleared.relations);
  assert.deepEqual(b.errors, []);
  const grouped = structuredClone(project);
  const record = (key) => grouped.records.find((item) => item.key === key);
  grouped.records.push({
    ...record('request'),
    key: 'request-writer',
    to: 'writer',
    contract: 'write-contract',
  });
  record('rejected').title = record('completed').title;
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    window.consumer.first.inspect('export');
  }, grouped);
  // The grouping assertions read the bundles, so wait for the map and not the
  // panel: the inspector titles the record before the graph has re-bundled.
  await settled(() => window.consumer.first.snapshot().relations);
  const beforeGrouping = await b.evaluate(() =>
    window.consumer.first.snapshot(),
  );
  for (const [direction, keys, endpoint] of [
    ['incoming', ['request', 'request-writer'], 'to'],
    ['outgoing', ['completed', 'rejected'], 'from'],
  ]) {
    const selector = `#first [data-direction=${direction}]`;
    assert.equal(
      await b.evaluate(
        (selector) =>
          document.querySelectorAll(selector + ' [data-interface-group]')
            .length,
        selector,
      ),
      1,
    );
    await click(selector + ' [data-interface-group] > summary');
    assert.deepEqual(
      await b.evaluate(
        (selector) =>
          [...document.querySelectorAll(selector + ' [data-interface]')].map(
            (element) => element.dataset.interface,
          ),
        selector,
      ),
      keys,
    );
    assert(
      (
        await b.evaluate(
          (selector) =>
            document.querySelector(selector + ' .interface-count').textContent,
          selector,
        )
      ).includes(String(keys.length)),
    );
    for (const key of keys) {
      const edge = record(key);
      const member = `${selector} [data-interface=${key}]`;
      const detail = await b.evaluate((selector) => {
        const element = document.querySelector(selector);
        return {
          title: element.querySelector('h4').textContent,
          payload: element.querySelector('p').textContent,
          height: element.getBoundingClientRect().height,
        };
      }, member);
      assert(detail.height > 0);
      assert(detail.title.includes(record(edge[endpoint]).title));
      assert.equal(detail.payload, record(edge.contract).payload);
      await click(member + ' button');
      assert.equal(
        await b.evaluate(
          () =>
            document.querySelectorAll('#first .panel-relations > section')
              .length,
        ),
        1,
      );
      assert(
        (
          await b.evaluate(
            () =>
              document.querySelector('#first .panel-relations .payload')
                .textContent,
          )
        ).endsWith(record(edge.contract).payload),
      );
      await click('#first [data-control=record-back]');
      assert(
        await b.evaluate(
          (selector) =>
            document.querySelector(selector + ' [data-interface-group]').open,
          selector,
        ),
      );
    }
  }
  const afterGrouping = await b.evaluate(() =>
    window.consumer.first.snapshot(),
  );
  assert.deepEqual(afterGrouping.nodeGeometry, beforeGrouping.nodeGeometry);
  assert.deepEqual(afterGrouping.relations, beforeGrouping.relations);
  const confirmed = structuredClone(project);
  confirmed.records = confirmed.records.filter(
    (record) => record.key !== 'exclude-private',
  );
  await fs.mkdir(evidenceDirectory, { recursive: true });
  const checker = await fs.readFile(
    new URL('fixtures/evidence-check.mjs', import.meta.url),
  );
  await fs.writeFile(new URL('fixture.mjs', evidenceDirectory), checker);
  confirmed.bindings = Object.fromEntries(
    confirmed.records
      .filter((record) =>
        ['scope', 'component', 'interaction', 'interface'].includes(
          record.type,
        ),
      )
      .map((record) => [
        record.key,
        { path: 'fixture.mjs', digest: hashBytes(checker) },
      ]),
  );
  confirmed.records.find((record) => record.key === 'export-check').command = [
    process.execPath,
    'fixture.mjs',
  ];
  confirmed.records.push({
    ...confirmed.records.find((record) => record.key === 'export-check'),
    key: 'unit-check',
    level: 'unit',
    covers: ['within-limit'],
    scenarios: [],
  });
  const contract = contractDigest(confirmed);
  for (const record of confirmed.records)
    if ('basis' in record) record.basis = { contract };
  confirmed.records.push(
    await executeProjectCheck(confirmed, 'unit-check', {
      directory: evidenceDirectory.pathname,
      resultKey: 'unit-run',
      evidencePath: 'unit-run.json',
    }),
  );
  await fs.writeFile(
    new URL('project.json', evidenceDirectory),
    JSON.stringify(confirmed),
  );
  for (const [stage, expected, verifiedResults] of [
    [0, 'partial', ['unit-run']],
    [1, 'confirmed', ['unit-run', 'run']],
    [2, 'partial', ['unit-run']],
    [3, 'unconfirmed', []],
  ]) {
    if (stage === 1) {
      confirmed.records.push(
        await executeProjectCheck(confirmed, 'export-check', {
          directory: evidenceDirectory.pathname,
          resultKey: 'run',
          evidencePath: 'run.json',
        }),
      );
      await fs.writeFile(
        new URL('project.json', evidenceDirectory),
        JSON.stringify(confirmed),
      );
    }
    if (stage === 2) await fs.rm(new URL('run.json', evidenceDirectory));
    if (stage === 3) await fs.rm(new URL('unit-run.json', evidenceDirectory));
    await b.evaluate(async () => {
      await window.consumer.first.load(
        new URL('./implementation-fixture/project.json', document.baseURI),
      );
      await window.consumer.first.focus('writer');
      window.consumer.first.inspect('writer');
    });
    // The evidence recheck repaints the marks, so settle on what is asserted.
    await settled(() =>
      [...document.querySelectorAll('#first [data-node]')].map(
        (node) => node.dataset.implementationState,
      ),
    );
    const status = await b.evaluate(() => ({
      nodes: [...document.querySelectorAll('#first [data-node]')].map(
        (node) => ({
          key: node.dataset.node,
          status: node.dataset.implementationState,
          mark: node.querySelector('.implementation-mark').dataset
            .implementationState,
        }),
      ),
      edges: [...document.querySelectorAll('#first [data-relation]')].map(
        (edge) => ({
          status: edge.dataset.implementationState,
          mark: edge.querySelector('.implementation-mark').dataset
            .implementationState,
        }),
      ),
      card: document.querySelector('#first .implementation').dataset
        .implementationState,
      criteria: document.querySelector('#first [data-node=writer] meter')
        ?.value,
    }));
    assert(status.nodes.length && status.edges.length);
    const analysis = analyzeProject(confirmed, { verifiedResults });
    for (const item of status.nodes)
      assert.equal(item.status, analysis.completion[item.key].state);
    for (const item of [...status.nodes, ...status.edges])
      assert.equal(item.mark, item.status);
    assert.equal(status.card, expected);
    assert.equal(status.criteria, [1, 2, 1, 0][stage]);
    assert.equal(
      status.nodes.find((node) => node.key === 'writer').status,
      expected,
    );
    if (stage === 0) {
      const progress = await b.evaluate(
        () =>
          document.querySelector('#first .implementation-progress p')
            .textContent,
      );
      assert.equal(
        progress,
        copy.criteriaProgress
          .replace('{confirmed}', '1')
          .replace('{total}', '2'),
      );
      await click('#first [data-disclosure=writer-confirmed-criteria] summary');
      await b.capture('consumer-partial-implementation');
      await click(
        '#first [data-disclosure=writer-confirmed-criteria] [data-record-link=within-limit]',
      );
      assert.equal(
        await b.evaluate(
          () =>
            document.querySelector('#first [data-record-title]').textContent,
        ),
        confirmed.records.find((record) => record.key === 'within-limit').title,
      );
      await click('#first [data-control=record-back]');
      assert(
        await b.evaluate(
          () =>
            document.querySelector(
              '#first [data-disclosure=writer-confirmed-criteria]',
            ).open,
        ),
      );
    }
  }
  const requirementsOnly = structuredClone(project);
  assert.equal(
    await b.evaluate(async (model) => {
      const moving = window.consumer.first.focus('writer');
      await window.consumer.first.load(model);
      return await moving;
    }, project),
    false,
  );
  requirementsOnly.entry = null;
  requirementsOnly.records = requirementsOnly.records.filter((record) =>
    ['scope', 'source', 'requirement'].includes(record.type),
  );
  for (const record of requirementsOnly.records.filter(
    (record) => record.type === 'requirement',
  ))
    record.appliesTo = [requirementsOnly.root];
  await b.evaluate(
    async (model) => await window.consumer.first.load(model),
    requirementsOnly,
  );
  assert.equal(
    await b.evaluate(() => window.consumer.first.snapshot().panel),
    'project',
  );
  await click('#first [data-project-view=all]');
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-record]').length,
    ),
    requirementsOnly.records.length,
  );
  const withDocuments = structuredClone(project);
  withDocuments.records.push(
    ...JSON.parse(
      await fs.readFile(
        new URL('./fixtures/documents.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const previousDocument = structuredClone(
    withDocuments.records.find((r) => r.key === 'doc-rules'),
  );
  withDocuments.history.push({
    digest: digest(previousDocument),
    record: previousDocument,
  });
  withDocuments.records
    .find((r) => r.key === 'doc-rules')
    .blocks.push({
      kind: 'paragraph',
      lines: [
        [
          '**Owns:** `export` [Routing](routing.json) [Context](#other-context) <img src=x onerror=alert(1)> [outside](https://example.com)',
        ],
      ],
    });
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    window.consumer.first.inspect('doc-rules');
  }, withDocuments);
  await until(
    () =>
      document.querySelectorAll(
        '#first [data-control=inspector] > .project-document [data-document-section]',
      ).length === 3,
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll(
          '#first [data-control=inspector] > .project-document details',
        ).length,
    ),
    0,
  );
  assert(
    await b.evaluate(() =>
      document
        .querySelector('#first .project-document')
        .textContent.includes('maxRows'),
    ),
  );
  await click('#first .project-document [data-record-link=within-limit]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'within-limit',
  );
  await b.capture('consumer-structured-documents');
  await click('#first [data-control=record-back]');
  assert(
    await b.evaluate(() => {
      const doc = document.querySelector('#first .project-document');
      return (
        !!doc.querySelector('strong') &&
        !!doc.querySelector('code') &&
        !doc.querySelector('img, a[href], script') &&
        doc.textContent.includes('<img src=x onerror=alert(1)>')
      );
    }),
  );
  for (let visit = 0; visit < 2; visit++) {
    await b.evaluate(() => {
      document.querySelector('#first aside').scrollTop = 0;
    });
    await click(
      '#first [data-control=inspector] > .project-document [data-record-link=doc-rules]',
    );
    await until(
      () => document.activeElement.dataset.documentAnchor === 'other-context',
    );
  }
  const documentScroll = await b.evaluate(() => {
    document
      .querySelector(
        '#first [data-control=inspector] > .project-document [data-record-link=doc-routing]',
      )
      .scrollIntoView({ block: 'nearest' });
    return document.querySelector('#first aside').scrollTop;
  });
  await click('#first .project-document [data-record-link=doc-routing]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'doc-routing',
  );
  await click('#first [data-control=record-back]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'doc-rules',
  );

  assert.equal(
    await b.evaluate(() => document.querySelector('#first aside').scrollTop),
    documentScroll,
  );
  await click('#first [data-disclosure=history] > summary');
  await click('#first .record-history > details > summary');
  assert(
    await b.evaluate(() => {
      const comparison = document.querySelector('#first .revision-comparison');
      return (
        comparison.querySelectorAll('.project-document').length === 2 &&
        !comparison.children[0].textContent.includes('Owns:') &&
        comparison.children[1].textContent.includes('Owns:') &&
        !comparison.querySelector('img, script, a[href]')
      );
    }),
  );
  // A question is a record, not a footnote. Every source stated as a question is
  // listed as open on the project surface, in the order the model states them,
  // and a project that asks nothing says so rather than hiding the list.
  const asking = (key, statement) => ({
    key,
    type: 'source',
    title: statement,
    scope: project.root,
    origin: 'question',
    statement,
  });
  const asked = structuredClone(project);
  asked.records.push(
    asking('retention-window', 'Who owns the retention window?'),
    asking('cache-shape', 'Is the cache per reader or shared?'),
  );
  await b.evaluate(
    async (model) => await window.consumer.first.load(model),
    asked,
  );
  await click('#first [data-control=project]');
  await until(() =>
    Boolean(document.querySelector('#first [data-open-questions]')),
  );
  assert.deepEqual(
    await b.evaluate(() =>
      [...document.querySelectorAll('#first [data-open-question]')].map(
        (element) => element.dataset.openQuestion,
      ),
    ),
    ['retention-window', 'cache-shape'],
  );
  const questionList = await b.evaluate(
    () => document.querySelector('#first [data-open-questions]').textContent,
  );
  for (const text of [
    copy.openQuestions,
    copy.openQuestionsNote,
    'Who owns the retention window?',
    'Is the cache per reader or shared?',
  ])
    assert(questionList.includes(text), 'the open list omits ' + text);
  // The list is a way into the record, and the record names its origin with the
  // shipped word for an open question rather than the schema's enum.
  await click('#first [data-open-question=cache-shape]');
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'cache-shape',
  );
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first [data-control=inspector]').textContent,
      )
    ).includes(copy.values.question),
    'the record does not read its origin as an open question',
  );
  await b.capture('project-open-questions');
  await b.evaluate(
    async (model) => await window.consumer.first.load(model),
    project,
  );
  await click('#first [data-control=project]');
  await until(() =>
    Boolean(document.querySelector('#first [data-open-questions]')),
  );
  assert.equal(
    await b.evaluate(
      () => document.querySelectorAll('#first [data-open-question]').length,
    ),
    0,
  );
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first [data-open-questions]').textContent,
      )
    ).includes(copy.noOpenQuestions),
    'an empty open list says nothing',
  );

  // A claim says when it was written, by whom, and how long it stays current. A
  // claim that outlived that life reads as ageing, not as current.
  const dated = (age, life) => {
    const model = structuredClone(project);
    model.records.find((r) => r.key === model.root).claimLife = life;
    const contract = contractDigest(model);
    model.records.find((r) => r.key === 'streaming').basis = {
      contract,
      at: new Date(Date.now() - age * 86400000).toISOString(),
      by: 'A. Reviewer',
    };
    return model;
  };
  const stale = dated(40, 30);
  const writtenAt = stale.records.find((r) => r.key === 'streaming').basis.at;
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    window.consumer.first.inspect('streaming');
  }, stale);
  await until(
    () =>
      document.querySelector('#first [data-record-title]')?.dataset
        .recordTitle === 'streaming',
  );
  const standing = await b.evaluate(() => {
    const element = document.querySelector('#first .claim-standing');
    return (
      element && { ageing: element.dataset.ageing, text: element.textContent }
    );
  });
  assert(standing, 'the inspector shows no attribution for a written claim');
  assert.equal(standing.ageing, 'true');
  for (const text of [
    copy.claimAuthor,
    'A. Reviewer',
    copy.claimWritten,
    writtenAt,
    copy.claimLife,
  ])
    assert(standing.text.includes(text), 'the attribution omits ' + text);
  const verdict = await b.evaluate(
    () => document.querySelector('#first .implementation > p').textContent,
  );
  assert(
    verdict.includes(copy.ageing),
    'an ageing claim still reads as current: ' + verdict,
  );
  assert(!verdict.includes(copy.yes), verdict);
  if (
    !(await b.evaluate(
      () => document.querySelector('#first .project-reasons').open,
    ))
  )
    await click('#first .project-reasons > summary');
  assert(
    (
      await b.evaluate(
        () =>
          document.querySelector('#first [data-reason=CLAIM_AGEING]')
            ?.textContent,
      )
    )?.includes(copy.reasonsByCode.CLAIM_AGEING),
    'an ageing claim reports no reason',
  );
  await b.capture('project-claim-ageing');
  // The same claim inside its stated life is current, and still says who wrote it.
  await b.evaluate(
    async (model) => {
      await window.consumer.first.load(model);
      window.consumer.first.inspect('streaming');
    },
    dated(40, 3650),
  );
  await until(
    () =>
      document.querySelector('#first .claim-standing')?.dataset.ageing ===
      'false',
  );
  const fresh = await b.evaluate(() => ({
    text: document.querySelector('#first .claim-standing').textContent,
    verdict: document.querySelector('#first .implementation > p').textContent,
    reason: document.querySelector('#first [data-reason=CLAIM_AGEING]'),
  }));
  assert(fresh.text.includes('A. Reviewer'));
  assert(fresh.verdict.includes(copy.yes), fresh.verdict);
  assert(!fresh.verdict.includes(copy.ageing), fresh.verdict);
  assert.equal(
    fresh.reason,
    null,
    'a claim inside its life is reported ageing',
  );

  // A long title must leave every visible card fact inside its bounds.
  const cramped = structuredClone(project);
  cramped.records.find((r) => r.key === 'screen').title =
    'Streaming output writer with explicit cancellation and bounded memory';
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    await window.consumer.first.home();
  }, cramped);
  await settled(() => window.consumer.first.snapshot().viewport);
  assert.deepEqual(
    await b.evaluate(() =>
      [
        ...document.querySelectorAll('#first .node-card:not(.expanded)'),
      ].flatMap((card) => {
        const copy = card.querySelector('.card-copy');
        return copy.scrollHeight > copy.clientHeight + 1
          ? [card.dataset.node]
          : [];
      }),
    ),
    [],
  );
  await click('#first [data-node=screen]');
  await until(
    () => !!document.querySelector('#first [data-control=neighbours]'),
  );
  await click('#first [data-control=neighbours] > summary');
  assert(
    await b.evaluate(() => {
      const neighbours = document
        .querySelector('#first [data-control=neighbours]')
        .getBoundingClientRect();
      const overview = document
        .querySelector('#first [data-control=overview]')
        .getBoundingClientRect();
      return (
        neighbours.right <= overview.left ||
        neighbours.left >= overview.right ||
        neighbours.bottom <= overview.top ||
        neighbours.top >= overview.bottom
      );
    }),
  );
  await click('#first [data-control=project]');
  await click('#first [data-project-view=work]');
  assert(
    await b.evaluate(
      () =>
        document.querySelector('#first aside').clientWidth >
        document.querySelector('#first').clientWidth * 0.9,
    ),
  );
  await click('#first [data-control=map-options] > summary');
  await b.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Escape',
    code: 'Escape',
  });
  assert(
    await b.evaluate(
      () =>
        !document.querySelector('#first [data-control=map-options]').open &&
        document.querySelector('#first .map-app').dataset.workspace === 'true',
    ),
  );
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await until(() => document.querySelector('#first').clientWidth <= 390);
  assert(
    await b.evaluate(() => {
      const panel = document.querySelector('#first aside');
      return (
        panel.scrollWidth === panel.clientWidth &&
        panel.clientHeight >
          document.querySelector('#first').clientHeight * 0.65
      );
    }),
  );
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
  }, project);
  assert.equal(
    await b.evaluate(
      () => document.querySelector('#first .map-app').dataset.workspace,
    ),
    'false',
  );
  assert.equal(
    await b.evaluate(
      () =>
        getComputedStyle(document.querySelector('#first .map-pane')).visibility,
    ),
    'visible',
  );
  assert.deepEqual(b.errors, []);
  console.log(
    'PASS: project views, uncovered requirements, trace links, fixed map geometry, mobile controls, plain-text rendering, the open-questions list and claim attribution.',
  );
} finally {
  await harness.stop();
  await fs.rm(evidenceDirectory, { recursive: true, force: true });
}
