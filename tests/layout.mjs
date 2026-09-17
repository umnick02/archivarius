import assert from 'node:assert/strict';
import { startHarness } from './harness.mjs';
import { waiter } from './cdp.mjs';

// What the eye sees, measured. The other browser suites ask whether an element
// exists and answers; this one asks whether it can be read: nothing overlapping
// something else, nothing cut off by an edge, the drawing centred in the space it
// was given and no control saying the same thing twice. Every verdict is a
// rectangle comparison, so a disagreement here is arithmetic rather than taste.
//
// Two mounts are measured because the failures differ with width: `#first` is
// half of a 1440px page - the width a host gives a map beside something else -
// and `#react-map` is the full page.
const harness = await startHarness();
const b = harness.browser;
const until = waiter(b);
const mounts = ['#first', '#react-map'];

// One reading of one mount. Everything the oracles need is collected in a single
// evaluation so all rectangles come from the same frame.
const read = (mount) =>
  b.evaluate((mount) => {
    const root = document.querySelector(mount + ' .map-app');
    if (!root) return null;
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const named = (selector, label) =>
      [...root.querySelectorAll(selector)]
        .filter((element) => element.getClientRects().length)
        .map((element) => ({
          label:
            label ||
            element.dataset.control ||
            element.className ||
            element.tagName.toLowerCase(),
          ...box(element),
        }));
    const pane = root.querySelector('.map-pane');
    const identity = root.querySelector('.identity');
    const controls = root.querySelector('.header-right');
    const nodes = [...root.querySelectorAll('[data-node]')]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ label: element.dataset.node, ...box(element) }));
    const union = nodes.length
      ? {
          left: Math.min(...nodes.map((node) => node.left)),
          right: Math.max(...nodes.map((node) => node.right)),
          top: Math.min(...nodes.map((node) => node.top)),
          bottom: Math.max(...nodes.map((node) => node.bottom)),
        }
      : null;
    // A card's own content against the box the layout gave it: the sum of what is
    // drawn inside, not the box, is what a reader gets for the space.
    const cards = [...root.querySelectorAll('[data-node]')]
      .filter((element) => element.getClientRects().length)
      .map((element) => {
        const inner = [...element.children].filter(
          (child) => child.getClientRects().length,
        );
        const content = inner.length
          ? Math.max(
              ...inner.map((child) => child.getBoundingClientRect().bottom),
            ) -
            Math.min(...inner.map((child) => child.getBoundingClientRect().top))
          : 0;
        return {
          label: element.dataset.node,
          height: element.getBoundingClientRect().height,
          content,
        };
      });
    return {
      root: box(root),
      pane: pane ? box(pane) : null,
      identity: identity ? box(identity) : null,
      controls: controls
        ? {
            ...box(controls),
            scrollWidth: controls.scrollWidth,
            clientWidth: controls.clientWidth,
          }
        : null,
      headerItems: named('header button, header select, header input'),
      overlays: named(
        [
          '[data-control=appearance-legend]',
          '[data-control=implementation-legend]',
          '[data-control=overview]',
          '.hint',
          '.map-controls',
        ].join(','),
      ),
      nodes,
      union,
      cards,
      // The words, to catch a control that repeats another one.
      level:
        root.querySelector('[data-control=level]')?.textContent.trim() ?? '',
      crumbs: [
        ...root.querySelectorAll('[data-control=breadcrumbs] button'),
      ].map((button) => button.textContent.trim()),
      searchPlaceholder:
        root.querySelector('[data-control=node-search]')?.placeholder ?? '',
      searchOptions: [
        ...root.querySelectorAll('[data-control=node-search-results] option'),
      ].map((option) => option.textContent.trim()),
    };
  }, mount);

const overlap = (a, b) => {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 1 && height > 1 ? Math.round(width * height) : 0;
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
  await b.evaluate(() => window.consumer.ready);
  await b.evaluate(() => window.consumer.first.home());
  await until(() => Boolean(document.querySelector('#first [data-node]')));

  for (const mount of mounts) {
    const view = await read(mount);
    assert(view, 'no map mounted in ' + mount);

    // 1. The identity and the controls are two zones, not one pile.
    const collisions = view.headerItems
      .map((item) => ({ item, area: overlap(view.identity, item) }))
      .filter((entry) => entry.area > 0);
    assert.deepEqual(
      collisions.map((entry) => entry.item.label + ' ' + entry.area + 'px²'),
      [],
      mount + ': a header control overlaps the identity',
    );

    // 2. Nothing is cut off by the right edge, and the control row does not
    //    silently scroll what it cannot fit.
    assert.deepEqual(
      view.headerItems
        .filter((item) => item.right > view.root.right + 0.5)
        .map((item) => item.label),
      [],
      mount + ': a header control is clipped by the right edge',
    );
    assert.ok(
      view.controls.scrollWidth <= view.controls.clientWidth + 1,
      mount +
        ': the control row overflows by ' +
        Math.round(view.controls.scrollWidth - view.controls.clientWidth) +
        'px instead of wrapping',
    );

    // 3. The overlays share the pane with the drawing: they may not cover a part,
    //    each other, or hang outside the pane.
    for (const overlay of view.overlays) {
      assert.ok(
        overlay.left >= view.pane.left - 1 &&
          overlay.right <= view.pane.right + 1 &&
          overlay.top >= view.pane.top - 1 &&
          overlay.bottom <= view.pane.bottom + 1,
        mount + ': overlay ' + overlay.label + ' hangs outside the pane',
      );
    }
    const covered = [];
    for (const overlay of view.overlays)
      for (const node of view.nodes)
        if (overlap(overlay, node))
          covered.push(overlay.label + ' covers ' + node.label);
    assert.deepEqual(covered, [], mount + ': an overlay covers a part');
    const stacked = [];
    for (let i = 0; i < view.overlays.length; i++)
      for (let j = i + 1; j < view.overlays.length; j++)
        if (overlap(view.overlays[i], view.overlays[j]))
          stacked.push(
            view.overlays[i].label + ' over ' + view.overlays[j].label,
          );
    assert.deepEqual(stacked, [], mount + ': two overlays overlap');

    // 4. The drawing is framed in the room the chrome leaves - not in the pane,
    //    which the chrome stands on. The free rectangle is measured from the
    //    overlays themselves: each is charged to the edge it hugs, so the numbers
    //    the app fits against are read back from the page rather than restated
    //    here. The drawing fills that rectangle along one axis and sits in the
    //    middle of both.
    const free = { ...view.pane };
    for (const overlay of view.overlays) {
      const gaps = {
        top: overlay.top - view.pane.top,
        bottom: view.pane.bottom - overlay.bottom,
        left: overlay.left - view.pane.left,
        right: view.pane.right - overlay.right,
      };
      const edge = Object.entries(gaps).sort((a, b) => a[1] - b[1])[0][0];
      if (edge === 'top') free.top = Math.max(free.top, overlay.bottom);
      if (edge === 'bottom') free.bottom = Math.min(free.bottom, overlay.top);
      if (edge === 'left') free.left = Math.max(free.left, overlay.right);
      if (edge === 'right') free.right = Math.min(free.right, overlay.left);
    }
    free.width = free.right - free.left;
    free.height = free.bottom - free.top;
    const width = view.union.right - view.union.left;
    const height = view.union.bottom - view.union.top;
    assert.ok(
      width / free.width >= 0.55 || height / free.height >= 0.55,
      mount +
        ': the drawing fills only ' +
        Math.round((width / free.width) * 100) +
        '% by ' +
        Math.round((height / free.height) * 100) +
        '% of the free room',
    );
    const offset = {
      x:
        Math.abs(
          (view.union.left + view.union.right) / 2 -
            (free.left + free.right) / 2,
        ) / free.width,
      y:
        Math.abs(
          (view.union.top + view.union.bottom) / 2 -
            (free.top + free.bottom) / 2,
        ) / free.height,
    };
    assert.ok(
      offset.x <= 0.05 && offset.y <= 0.05,
      mount +
        ': the drawing sits off centre by ' +
        Math.round(offset.x * 100) +
        '% and ' +
        Math.round(offset.y * 100) +
        '% of the free room',
    );

    // 5. A box is mostly what it says, and no control repeats another.
    assert.deepEqual(
      view.cards
        .filter((card) => card.height > 0 && card.content / card.height < 0.6)
        .map(
          (card) =>
            card.label +
            ' ' +
            Math.round((card.content / card.height) * 100) +
            '% filled',
        ),
      [],
      mount + ': a box is mostly empty space',
    );
    assert.deepEqual(
      view.searchOptions.filter(
        (option) => option === view.searchPlaceholder.trim(),
      ),
      [],
      mount + ': the result list repeats the search placeholder as an option',
    );
    // A line that names the level the reader is on is worth a corner of the pane
    // only while it says something the crumb beside it does not.
    const words = (text) =>
      text
        .toLowerCase()
        .replace(/[^a-z ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter((word) => word !== 'level');
    assert.deepEqual(
      view.crumbs.filter(
        (crumb) => words(crumb).join(' ') === words(view.level).join(' '),
      ),
      [],
      mount + ': the level line repeats the breadcrumb beside it',
    );
  }
  assert.deepEqual(b.errors, []);
  console.log('PASS: the map is readable at both widths.');
} finally {
  await harness.stop();
}
