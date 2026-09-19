import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';
import { waiter } from './cdp.mjs';

// An accessibility failure fails the build. Two oracles run here, both against
// the installed package in a real browser: an axe-core audit of every rendered
// map, in each of the reader settings the surface claims to honour, and a
// keyboard walk-through that reaches the map, moves between parts, opens a panel
// and gets back out without a pointer. A violation of impact serious or critical
// stops the run; everything else is printed, because a screenshot review is not a
// check.
const axeSource = await fs.readFile(
  new URL('../node_modules/axe-core/axe.min.js', import.meta.url),
  'utf8',
);
// The conformance list `standard-accessibility` names, plus axe's own practice
// rules — those only ever print unless they are serious.
const tags = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];
const fatal = new Set(['serious', 'critical']);

const harness = await startHarness();
const b = harness.browser;
const until = waiter(b);
const keys = {
  Tab: { code: 'Tab', vk: 9 },
  Enter: { code: 'Enter', vk: 13 },
  Escape: { code: 'Escape', vk: 27 },
  ' ': { code: 'Space', vk: 32, text: ' ' },
  End: { code: 'End', vk: 35 },
  Home: { code: 'Home', vk: 36 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  F6: { code: 'F6', vk: 117 },
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
const media = (features) => b.call('Emulation.setEmulatedMedia', { features });
const metrics = (width, height, mobile = false) =>
  b.call('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });

// Where the keyboard stands and whether a reader could see it get there: the
// element has to be on screen, rendered, and drawing the ring the surface
// promises for a keyboard.
const here = () =>
  b.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body)
      return { name: 'body', focused: false };
    const holder = element.closest(
      '[data-node],[data-relation],[data-control]',
    );
    const data = holder?.dataset || {};
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      name: data.node
        ? 'node:' + data.node
        : data.relation
          ? 'relation:' + data.relation
          : data.control || element.getAttribute('class') || element.tagName,
      focused: true,
      inMap: Boolean(element.closest('#first')),
      rendered: element.checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
        contentVisibilityAuto: true,
      }),
      onScreen:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth,
      focusVisible: element.matches(':focus-visible'),
      ring:
        (style.outlineStyle !== 'none' &&
          parseFloat(style.outlineWidth) >= 2) ||
        style.boxShadow !== 'none',
    };
  });
const walked = [];
// Every stop of the walk answers the same three questions, so a step that lands
// nowhere, lands off screen or lands without a ring fails where it happened.
const standing = async (step) => {
  const spot = await here();
  walked.push(step + ' → ' + spot.name);
  assert(spot.focused, step + ': focus fell to the document body');
  assert(spot.rendered, step + ': ' + spot.name + ' is not rendered');
  assert(spot.onScreen, step + ': ' + spot.name + ' is off screen');
  assert(
    spot.focusVisible,
    step + ': ' + spot.name + ' does not report :focus-visible',
  );
  assert(spot.ring, step + ': ' + spot.name + ' draws no focus ring');
  return spot;
};

const findings = [];
const audit = async (label, selector) => {
  const outcome = await b.evaluate(
    async (selector, tags) => {
      const context = document.querySelector(selector);
      if (!context) throw new Error('AUDIT_CONTEXT_MISSING: ' + selector);
      const result = await window.axe.run(context, {
        resultTypes: ['violations', 'incomplete'],
        runOnly: { type: 'tag', values: tags },
      });
      const brief = (issues) =>
        issues.map((issue) => ({
          id: issue.id,
          impact: issue.impact,
          help: issue.help,
          count: issue.nodes.length,
          where: issue.nodes
            .slice(0, 3)
            .map(
              (node) =>
                node.target.join(' ') +
                ' :: ' +
                (node.failureSummary || '').replace(/\s+/g, ' ').slice(0, 220),
            ),
        }));
      return {
        violations: brief(result.violations),
        incomplete: brief(result.incomplete),
        passes: result.passes.length,
      };
    },
    selector,
    tags,
  );
  const serious = outcome.violations.filter((issue) => fatal.has(issue.impact));
  console.log(
    '  ' +
      label.padEnd(34) +
      outcome.passes +
      ' rules pass, ' +
      outcome.violations.length +
      ' violations (' +
      serious.length +
      ' serious or critical), ' +
      outcome.incomplete.length +
      ' needing review',
  );
  for (const issue of outcome.violations)
    console.log(
      '    ' +
        (fatal.has(issue.impact) ? 'FAIL ' : 'note ') +
        issue.impact +
        ' · ' +
        issue.id +
        ' · ' +
        issue.help +
        ' ×' +
        issue.count +
        '\n      ' +
        issue.where.join('\n      '),
    );
  for (const issue of outcome.incomplete)
    console.log(
      '    review ' + issue.id + ' · ' + issue.help + ' ×' + issue.count,
    );
  findings.push(...serious.map((issue) => label + ': ' + issue.id));
  return outcome;
};

try {
  await metrics(1440, 1000);
  await b.call('Page.navigate', { url: harness.url });
  await until(() => Boolean(window.consumer));
  await b.evaluate(async () => {
    await Promise.race([
      window.consumer.ready,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('READY_TIMEOUT')), 20000),
      ),
    ]);
  });
  await b.call('Runtime.evaluate', { expression: axeSource });
  assert(
    await b.evaluate(() => typeof window.axe?.run === 'function'),
    'axe-core did not load',
  );

  console.log('axe-core ' + (await b.evaluate(() => window.axe.version)));
  // Every map on the page, in the state a reader first meets it.
  for (const [label, selector] of [
    ['mounted map', '#first'],
    ['second mounted map', '#second'],
    ['React component', '#react-map .archivarius'],
  ])
    await audit(label, selector);

  // With a panel open: the inspector is half the reading surface and axe has to
  // see it, not only the map behind it.
  await b.evaluate(() => window.consumer.first.inspect('engine'));
  await until(() => window.consumer.first.snapshot().panel !== null);
  await audit('map with a panel open', '#first');

  // The reader's settings, each audited in turn: the same surface, the same
  // rules, a different preference. A contrast failure in a dark scheme is a
  // failure of the surface, not of the reader.
  for (const [label, features] of [
    ['dark scheme', [{ name: 'prefers-color-scheme', value: 'dark' }]],
    ['reduced motion', [{ name: 'prefers-reduced-motion', value: 'reduce' }]],
    ['more contrast', [{ name: 'prefers-contrast', value: 'more' }]],
  ]) {
    await media(features);
    await audit(label, '#first');
  }
  await media([]);

  // WCAG 1.4.4: doubling the reader's text size doubles the text, and nothing the
  // surface draws is lost or clipped when it does.
  const zoomed = await b.evaluate(async () => {
    const read = () => {
      const of = (selector) => {
        const element = document.querySelector('#first ' + selector);
        return element ? parseFloat(getComputedStyle(element).fontSize) : null;
      };
      const box = (selector) => {
        const rect = document
          .querySelector('#first ' + selector)
          ?.getBoundingClientRect();
        return (
          rect && { top: rect.top, bottom: rect.bottom, height: rect.height }
        );
      };
      return {
        inspector: of('[data-control="inspector"]'),
        menu: of('[data-control=map-options] > summary'),
        control: of('[data-control="contracts"]'),
        header: box('header'),
        pane: box('.map-pane'),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        clipped: [
          ...document.querySelectorAll(
            '#first [data-control=map-options] > summary, #first [data-control="contracts"], #first [data-control="inspector"] h2',
          ),
        ]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => element.className || element.tagName),
      };
    };
    const before = read();
    document.documentElement.style.fontSize = '32px';
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    const after = read();
    document.documentElement.style.fontSize = '';
    return { before, after };
  });
  console.log(
    '  text zoom 200%: ' +
      ['inspector', 'menu', 'control']
        .map(
          (name) =>
            name + ' ' + zoomed.before[name] + '→' + zoomed.after[name] + 'px',
        )
        .join(', '),
  );
  for (const name of ['inspector', 'menu', 'control'])
    assert(
      zoomed.after[name] >= zoomed.before[name] * 1.8,
      'text zoom: ' +
        name +
        ' stayed at ' +
        zoomed.after[name] +
        'px, so its size is not the reader’s',
    );
  assert.equal(
    zoomed.after.overflow,
    false,
    'text zoom: the page scrolls sideways',
  );
  assert.deepEqual(
    zoomed.after.clipped,
    [],
    'text zoom: text is clipped by a box that did not grow with it',
  );
  assert(
    zoomed.after.pane.top >= zoomed.after.header.bottom - 1,
    'text zoom: the header grew over the map (' +
      JSON.stringify({
        header: zoomed.after.header.bottom,
        pane: zoomed.after.pane.top,
      }) +
      ')',
  );
  assert(
    zoomed.after.pane.height > 100,
    'text zoom: the map pane collapsed to ' + zoomed.after.pane.height,
  );

  // WCAG 2.3.3 / 2.2.2: a reader who asked for less motion gets none — no
  // transition and no animation anywhere on the surface, vendored rules included.
  await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const moving = await b.evaluate(() =>
    [...document.querySelectorAll('#first *')]
      .map((element) => {
        const style = getComputedStyle(element);
        const seconds = (value) =>
          Math.max(
            0,
            ...value.split(',').map((part) => {
              const time = parseFloat(part);
              return part.includes('ms') ? time / 1000 : time || 0;
            }),
          );
        return {
          name: element.dataset.control || element.className || element.tagName,
          transition:
            seconds(style.transitionDuration) + seconds(style.transitionDelay),
          animation:
            style.animationName === 'none'
              ? 0
              : seconds(style.animationDuration),
        };
      })
      .filter((entry) => entry.transition > 0.02 || entry.animation > 0.02)
      .slice(0, 10),
  );
  assert.deepEqual(moving, [], 'reduced motion: the surface still animates');
  await media([]);

  // WCAG 1.4.8 / forced colours: the author palette is thrown away, so the
  // surface has to restate itself in the reader's own colours instead of going
  // blank. `Canvas`, `CanvasText` and `Highlight` are read from the page itself.
  await media([{ name: 'forced-colors', value: 'active' }]);
  const forced = await b.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'CanvasText';
    probe.style.backgroundColor = 'Canvas';
    probe.style.borderColor = 'GrayText';
    document.body.append(probe);
    const system = getComputedStyle(probe);
    const colors = {
      text: system.color,
      canvas: system.backgroundColor,
      gray: system.borderColor,
    };
    probe.remove();
    const of = (selector) => {
      const element = document.querySelector('#first' + selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        borderWidth: parseFloat(style.borderTopWidth),
      };
    };
    return {
      colors,
      surface: of(' .archivarius, #first.archivarius'),
      header: of(' header'),
      panel: of(' [data-control="inspector"]'),
      card: of(' [data-node]'),
    };
  });
  const system = new Set(Object.values(forced.colors));
  const clear = (value) => /,\s*0\)$/.test(value);
  for (const [name, part] of Object.entries(forced))
    if (name !== 'colors' && part) {
      assert(
        system.has(part.color),
        'forced colours: ' +
          name +
          ' keeps the author text colour ' +
          part.color,
      );
      assert(
        clear(part.background) || system.has(part.background),
        'forced colours: ' +
          name +
          ' keeps the author background ' +
          part.background,
      );
    }
  assert(
    forced.card.borderWidth >= 1 && system.has(forced.card.border),
    'forced colours: a card loses its outline (' +
      JSON.stringify(forced.card) +
      ')',
  );
  // A forced palette drops every shadow, and the panel and the overlays float over
  // the map: without a border of their own they become text lying on the drawing.
  for (const name of ['panel'])
    assert(
      forced[name] &&
        forced[name].borderWidth >= 1 &&
        system.has(forced[name].border),
      'forced colours: ' +
        name +
        ' floats over the map with no edge of its own (' +
        JSON.stringify(forced[name]) +
        ')',
    );
  console.log('  forced colours: ' + JSON.stringify(forced.colors));
  await audit('forced colours', '#first');
  await media([]);

  // The keyboard walk-through. It starts outside the library, in the host page,
  // because reaching the map is part of what has to work.
  await b.evaluate(() => {
    window.consumer.first.home();
    document.querySelector('#host-input').focus();
  });
  await until(() => window.consumer.first.snapshot().panel === null);
  let stop;
  for (let step = 0; step < 24; step++) {
    await tab();
    stop = await standing('tab ' + (step + 1));
    if (stop.name.startsWith('node:')) break;
  }
  assert(
    stop.name.startsWith('node:'),
    'the keyboard never reached a part of the map: ' + walked.join(', '),
  );
  const firstPart = stop.name;
  // Moving between parts: the arrow keys walk the level the reader stands in.
  await press('ArrowRight');
  const second = await standing('ArrowRight');
  assert.notEqual(second.name, firstPart, 'the arrow key moved nowhere');
  assert(second.name.startsWith('node:'), 'the arrow key left the parts');
  await press('ArrowLeft');
  const back = await standing('ArrowLeft');
  assert.equal(back.name, firstPart, 'the arrow keys are not reversible');
  // Opening a panel and getting back out, both by key alone.
  await press(' ');
  await until(() => window.consumer.first.snapshot().panel !== null);
  const panel = await standing('Space');
  assert.equal(panel.name, 'inspector', 'Space did not hand over the panel');
  // Inside the panel the keyboard still moves: its own controls are reachable.
  await tab();
  const inside = await standing('tab inside the panel');
  assert(inside.inMap, 'the panel let the keyboard out of the map');
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  const returned = await standing('Escape');
  assert.equal(
    returned.name,
    firstPart,
    'closing the panel did not give focus back to the part that opened it',
  );
  // F6: the jump between the two named regions the surface is made of.
  await press(' ');
  await until(() => window.consumer.first.snapshot().panel !== null);
  await press('F6');
  const jumped = await standing('F6');
  await press('Escape');
  await until(() => window.consumer.first.snapshot().panel === null);
  console.log('  keyboard walk: ' + walked.join(' | '));
  console.log('  F6 landed on: ' + jumped.name);

  // WCAG 1.4.10: one column, no sideways scrolling, and nothing the reader needs
  // left off the surface. 320 physical pixels is 1280 at 400% zoom.
  await metrics(320, 700, true);
  await b.evaluate(() => window.consumer.first.home());
  await until(() => document.querySelectorAll('#first [data-node]').length > 0);
  const reflow = await b.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    cards: document.querySelectorAll('#first [data-node]').length,
    inside: [
      ...document.querySelectorAll(
        '#first :is(header, [data-control="inspector"])',
      ),
    ]
      .filter((element) =>
        element.checkVisibility({ visibilityProperty: true }),
      )
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const host = document.querySelector('#first').getBoundingClientRect();
        return rect.right > host.right + 1 || rect.left < host.left - 1;
      })
      .map((element) => element.dataset.control || element.tagName),
  }));
  assert.equal(reflow.overflow, false, 'one column: the page scrolls sideways');
  assert(reflow.cards > 0, 'one column: the map drew nothing');
  assert.deepEqual(
    reflow.inside,
    [],
    'one column: part of the surface hangs outside it',
  );
  await audit('one column at 320px', '#first');
  // A panel on a narrow surface takes the whole width, so it is audited there too.
  await b.evaluate(() => window.consumer.first.inspect('engine'));
  await until(() => window.consumer.first.snapshot().panel !== null);
  await audit('one column with a panel open', '#first');
  await metrics(1440, 1000);

  assert.deepEqual(
    findings,
    [],
    'accessibility violations must fail the build',
  );
  assert.deepEqual(b.errors, []);
  console.log(
    'PASS: axe-core audit in every reader setting, text zoom, reduced motion, forced colours, one-column reflow and a keyboard walk-through of the map and its panel.',
  );
} finally {
  await harness.stop();
}
