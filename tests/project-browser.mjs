import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { connectBrowser, pause } from './cdp.mjs';

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
    5,
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
  assert.deepEqual(b.errors, []);
  console.log(
    'PASS: project views, uncovered requirements, trace links, fixed map geometry, mobile controls and plain-text rendering.',
  );
} finally {
  b.close();
}
