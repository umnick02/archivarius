import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connectBrowser, pause } from './cdp.mjs';
import { analyzeProject, contractDigest } from '../src/project.mjs';
import { hashBytes } from '../src/digest.mjs';
import { executeProjectCheck } from '../src/node.mjs';

const project = JSON.parse(
  await fs.readFile(
    new URL('../examples/basic/public/project.json', import.meta.url),
    'utf8',
  ),
);
const copy = JSON.parse(
  await fs.readFile(
    new URL('../assets/project.ru.json', import.meta.url),
    'utf8',
  ),
);
const b = await connectBrowser();
const evidenceDirectory = new URL(
  '../.runtime/consumer/dist/implementation-fixture/',
  import.meta.url,
);
const click = async (selector) => {
  const point = await b.evaluate((selector) => {
    const element = document.querySelector(selector);
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('CONTROL_HIDDEN');
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  await b.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await b.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...point,
    button: 'left',
    clickCount: 1,
  });
  await pause(150);
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
  await pause(1000);
  await b.evaluate(async () => {
    await window.consumer.ready;
    await window.consumer.first.load(
      new URL('./project.json', document.baseURI),
    );
  });
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
  await pause(100);
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
  await pause(100);
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
  await pause(350);
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
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 900,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await pause(300);
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
  await pause(200);
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll('#first [data-control=inspector] img').length,
    ),
    0,
  );
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
      return pane.right <= panel.left;
    }),
  );
  await b.capture('project-overview-desktop');
  await click('#first [data-control=record-search]');
  await b.call('Input.insertText', { text: '1000' });
  await pause(100);
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
  await pause(100);
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
    await b.evaluate(() => document.activeElement.className),
    'map-pane',
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
  await pause(150);
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
  confirmed.bindings = {
    fixture: { path: 'fixture.mjs', digest: hashBytes(checker) },
  };
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
    await pause(150);
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
    }));
    assert(status.nodes.length && status.edges.length);
    const analysis = analyzeProject(confirmed, { verifiedResults });
    for (const item of status.nodes)
      assert.equal(item.status, analysis.completion[item.key].state);
    for (const item of [...status.nodes, ...status.edges])
      assert.equal(item.mark, item.status);
    assert.equal(status.card, expected);
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
  await b.evaluate(async (model) => {
    await window.consumer.first.load(model);
    window.consumer.first.inspect('doc-rules');
  }, withDocuments);
  await pause();
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelectorAll('#first .project-document > details').length,
    ),
    3,
  );
  await click('#first [data-disclosure=document-doc-rules-1] summary');
  assert(
    await b.evaluate(() =>
      document
        .querySelector('#first .project-document')
        .textContent.includes('maxRows'),
    ),
  );
  await click(
    '#first [data-disclosure=document-doc-rules-1] [data-record-link=within-limit]',
  );
  assert.equal(
    await b.evaluate(
      () =>
        document.querySelector('#first [data-record-title]').dataset
          .recordTitle,
    ),
    'within-limit',
  );
  await b.capture('consumer-structured-documents');
  assert.deepEqual(b.errors, []);
  console.log(
    'PASS: project views, uncovered requirements, trace links, fixed map geometry, mobile controls and plain-text rendering.',
  );
} finally {
  b.close();
  await fs.rm(evidenceDirectory, { recursive: true, force: true });
}
