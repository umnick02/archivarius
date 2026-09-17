import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';
import { waiter } from './cdp.mjs';
import { countParts, generateArchitecture } from './model-generator.mjs';

// The response budget, measured rather than asserted. The three numbers are the
// three budgets `research-response-time` names, so each is read from the
// requirement in `project.json` instead of written down here: a budget that
// changes there changes what this harness holds the map to.
const project = JSON.parse(
  await fs.readFile(new URL('../project.json', import.meta.url), 'utf8'),
);
const requirement = project.records.find(
  (record) =>
    record.type === 'requirement' && record.key === 'responsive-at-scale',
);
if (!requirement)
  throw new Error('BUDGET_MISSING: no responsive-at-scale requirement');
const budget = requirement.parameters || {};
for (const name of [
  'parts',
  'firstResponseMs',
  'interactiveMs',
  'fullLayoutMs',
])
  if (typeof budget[name] !== 'number')
    throw new Error('BUDGET_PARAMETER_MISSING: ' + name);

// What the run refuses to call a failure. A single browser measurement is noisy,
// so a spread wider than a quarter of the fastest run means the metric is not
// stable enough to be held to the stated number: it is then only failed when it
// is past the budget by a clear margin.
const spread = 1.25;
const margin = 1.5;
const repeats = 3;
const median = (values) =>
  [...values].sort((a, b) => a - b)[values.length >> 1];

const harness = await startHarness();
const b = harness.browser;
const until = waiter(b);

// One load of one generated model, measured from the page's own clock.
//
//   firstResponse — from the request to the first frame the page paints after it:
//                   whether the surface answers a reader's gesture at once.
//   interactive   — the longest gap between two beats of a self-rescheduling
//                   timer while the load runs: the worst time the page was unable
//                   to answer a reader at all.
//   fullLayout    — from the request to the frame after the model is laid out and
//                   mounted: the whole wait.
const measure = (data) =>
  b.evaluate(async (data) => {
    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => resolve(performance.now())),
      );
    const beat = { max: 0, beats: 0, last: performance.now(), stop: false };
    const pulse = () => {
      const now = performance.now();
      beat.max = Math.max(beat.max, now - beat.last);
      beat.last = now;
      beat.beats++;
      if (!beat.stop) setTimeout(pulse, 0);
    };
    const file = new File([JSON.stringify(data)], 'architecture.json', {
      type: 'application/json',
    });
    const started = window.work.urls.length;
    pulse();
    const start = performance.now();
    const settled = window.consumer.first.load(file);
    const answered = await frame();
    await settled;
    const painted = await frame();
    beat.stop = true;
    return {
      firstResponse: Math.round(answered - start),
      interactive: Math.round(beat.max),
      fullLayout: Math.round(painted - start),
      beats: beat.beats,
      offThread: window.work.urls.length > started,
      live: window.work.live,
      mounted: document.querySelectorAll('#first [data-node]').length,
      visible: window.consumer.first.snapshot().visible.length,
    };
  }, data);

const report = (name, values, limit) => {
  const middle = median(values);
  const stable = Math.max(...values) <= Math.min(...values) * spread;
  const allowed = stable ? limit : limit * margin;
  console.log(
    '  ' +
      name.padEnd(14) +
      values.map((value) => String(value).padStart(6)).join('') +
      '   median ' +
      String(middle).padStart(5) +
      'ms   budget ' +
      String(limit).padStart(5) +
      'ms   ' +
      (stable ? 'stable' : 'unstable, allowed ' + Math.round(allowed) + 'ms') +
      (middle > limit ? '   OVER BUDGET' : ''),
  );
  return { name, middle, limit, stable, allowed };
};

try {
  await b.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await b.call('Page.navigate', { url: harness.url });
  await until(() => Boolean(window.consumer));
  await b.evaluate(async () => {
    await window.consumer.ready;
    // Whether the geometry left the interface thread is part of the answer, so
    // the workers the load spawns are counted the way the render suite counts them.
    const real = window.Worker;
    window.work = { urls: [], live: 0 };
    window.Worker = class extends real {
      constructor(url, options) {
        super(url, options);
        window.work.urls.push(String(url));
        window.work.live++;
      }
      terminate() {
        window.work.live--;
        super.terminate();
      }
    };
  });

  const model = generateArchitecture(budget.parts);
  assert.equal(countParts(model), budget.parts);
  console.log(
    'Generated model: ' +
      countParts(model) +
      ' parts, ' +
      model.nodes.length +
      ' groups, ' +
      model.relations.length +
      ' relations, ' +
      Math.round(JSON.stringify(model).length / 1024) +
      ' KiB',
  );
  // A first load pays for code and worker startup nobody measures again, so it is
  // warm-up and not a measurement.
  const warm = await measure(model);
  assert.equal(
    warm.visible,
    model.nodes.length,
    'the generated model did not render',
  );
  const runs = [];
  for (let run = 0; run < repeats; run++) {
    // A fresh model each run: identical in shape, different in text, so the memoized
    // geometry cannot answer for a layout that was never computed.
    const varied = generateArchitecture(budget.parts, { salt: 'r' + run });
    runs.push(await measure(varied));
    assert.equal(runs.at(-1).visible, varied.nodes.length);
  }
  console.log(
    'Warm-up: ' +
      JSON.stringify(warm) +
      '\nMeasurements (' +
      repeats +
      ' loads of a freshly generated model):',
  );
  const verdicts = [
    report(
      'firstResponse',
      runs.map((run) => run.firstResponse),
      budget.firstResponseMs,
    ),
    report(
      'interactive',
      runs.map((run) => run.interactive),
      budget.interactiveMs,
    ),
    report(
      'fullLayout',
      runs.map((run) => run.fullLayout),
      budget.fullLayoutMs,
    ),
  ];
  console.log(
    '  mounted parts of ' +
      budget.parts +
      ': ' +
      runs.map((run) => run.mounted).join(', ') +
      '   layout off the interface thread: ' +
      runs.every((run) => run.offThread) +
      '   workers left running: ' +
      runs.at(-1).live,
  );
  // Mount what is visible. Zoomed into one part, the surface has no reason to keep
  // five hundred boxes alive: what the reader can see, and a margin around it, is
  // the whole of the DOM. The same call back out has to bring them back, or the
  // release is a loss rather than a saving.
  const virtualized = await b.evaluate(async () => {
    const settle = async () => {
      for (let i = 0; i < 30; i++)
        await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    const count = () => document.querySelectorAll('#first [data-node]').length;
    const placed = () => window.consumer.first.snapshot().visible.length;
    const groups = window.consumer.first.snapshot().visible;
    await window.consumer.first.focus(groups[0]);
    await settle();
    const inside = { placed: placed(), mounted: count() };
    await window.consumer.first.home();
    await settle();
    return { inside, home: { placed: placed(), mounted: count() } };
  });
  console.log(
    '  zoomed into one part: ' +
      virtualized.inside.mounted +
      ' mounted of ' +
      virtualized.inside.placed +
      ' placed; back at home: ' +
      virtualized.home.mounted +
      ' of ' +
      virtualized.home.placed,
  );
  assert.ok(
    virtualized.inside.mounted * 2 <= virtualized.inside.placed,
    'zoomed into one part the map mounted ' +
      virtualized.inside.mounted +
      ' of the ' +
      virtualized.inside.placed +
      ' parts it placed',
  );
  assert.equal(
    virtualized.home.mounted,
    virtualized.home.placed,
    'back at home the map did not mount every part it placed',
  );
  const over = verdicts.filter((verdict) => verdict.middle > verdict.allowed);
  assert.deepEqual(
    over.map(
      (verdict) =>
        verdict.name +
        ' ' +
        verdict.middle +
        'ms past ' +
        Math.round(verdict.allowed) +
        'ms',
    ),
    [],
    'the stated response budget was exceeded',
  );
  assert.deepEqual(b.errors, []);
  console.log(
    'PASS: ' +
      budget.parts +
      ' generated parts measured against the stated budget (' +
      verdicts
        .map((verdict) => verdict.name + ' ' + verdict.middle + 'ms')
        .join(', ') +
      ').',
  );
} finally {
  await harness.stop();
}
