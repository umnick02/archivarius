// Zoom is a decision before it is a picture: which containers are open at a given
// scale, what the level the reader stands in is called, and which positions the
// map can send them back to. All three live in `model/zoom.mjs`, so they are
// provable without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  expansionAt,
  expansionThresholds,
  levelName,
  namedLevel,
  previousPosition,
  pushPosition,
  zoomTarget,
} from '../src/model/zoom.mjs';
import { expandedAt } from '../src/ui/view.mjs';

const copy = JSON.parse(
  await fs.readFile(
    new URL('../assets/archivarius-strings.json', import.meta.url),
    'utf8',
  ),
);
const size = { width: 1440, height: 924 };
// One container of 800x600 with one part inside it: the smallest layout that can
// cross a threshold at all, so the numbers under test are the thresholds and not
// a fixture's geometry.
const layout = {
  nodes: {
    root: {
      key: 'root',
      parent: null,
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      depth: 0,
      root: 'root',
    },
    part: {
      key: 'part',
      parent: 'root',
      x: 40,
      y: 40,
      width: 300,
      height: 200,
      depth: 1,
      root: 'root',
    },
  },
  bounds: { x: 0, y: 0, width: 800, height: 600 },
};
const graph = {
  nodes: new Map([
    [
      'root',
      {
        key: 'root',
        title: 'Root',
        kind: 'subsystem',
        children: [
          { key: 'part', kind: 'component' },
          { key: 'store', kind: 'store' },
        ],
      },
    ],
    ['part', { key: 'part', title: 'Part', kind: 'component' }],
    [
      'mixed',
      {
        key: 'mixed',
        title: 'Mixed',
        kind: 'subsystem',
        children: [
          { key: 'inner', kind: 'component' },
          { key: 'group', kind: 'subsystem' },
        ],
      },
    ],
  ]),
  parents: new Map([
    ['root', null],
    ['part', 'root'],
    ['mixed', null],
  ]),
};

test('the collapsing threshold sits below the expanding one', () => {
  const thresholds = expansionThresholds(layout.nodes.root, size);
  assert(thresholds.expand.width > thresholds.collapse.width);
  assert(thresholds.expand.height > thresholds.collapse.height);
  // The threshold is a size on screen, so it is the box that has to reach it.
  assert.equal(
    thresholds.expand.width / layout.nodes.root.width >
      thresholds.collapse.width / layout.nodes.root.width,
    true,
  );
});

test('a container at its boundary keeps the state it already had', () => {
  const { expand, collapse } = expansionThresholds(layout.nodes.root, size);
  const opens = expand.width / layout.nodes.root.width;
  const closes = collapse.width / layout.nodes.root.width;
  assert(closes < opens, 'no hysteresis band exists');
  const between = (opens + closes) / 2;
  // Below the expanding threshold a closed container stays closed, and the same
  // scale keeps an open one open: the band is where nothing changes, so a box
  // resting on it cannot flicker.
  assert.deepEqual([...expansionAt({ layout, zoom: between, size })], []);
  assert.deepEqual(
    [
      ...expansionAt({
        layout,
        zoom: between,
        size,
        previous: new Set(['root']),
      }),
    ],
    ['root'],
  );
  assert.deepEqual([...expansionAt({ layout, zoom: opens, size })], ['root']);
  assert.deepEqual(
    [
      ...expansionAt({
        layout,
        zoom: closes * 0.98,
        size,
        previous: new Set(['root']),
      }),
    ],
    [],
  );
});

test('a container with nothing inside never expands', () => {
  const leaves = { ...layout, nodes: { part: layout.nodes.part } };
  assert.deepEqual([...expansionAt({ layout: leaves, zoom: 40, size })], []);
});

test('zoom steps follow hierarchy and stop at leaves and the overview', () => {
  const boxes = [
    ...Object.values(layout.nodes),
    {
      key: 'inner',
      parent: 'part',
      x: 60,
      y: 60,
      width: 60,
      height: 50,
      depth: 2,
    },
  ];
  const target = (current, direction, point = { x: 80, y: 80 }, preferred) =>
    zoomTarget({ boxes, current, direction, point, preferred });
  assert.equal(
    target(null, 1),
    'root',
    'a deep hit must not skip its ancestors',
  );
  assert.equal(target('root', 1), 'part');
  assert.equal(target('part', 1), 'inner');
  assert.equal(target('inner', 1), 'inner', 'a leaf cannot grow forever');
  assert.equal(target('inner', 1, { x: 700, y: 500 }), 'inner');
  assert.equal(target('part', 1, { x: 700, y: 500 }, 'root'), 'inner');
  assert.equal(target('inner', -1), 'part');
  assert.equal(target('part', -1), 'root');
  assert.equal(target('root', -1), null);
  assert.equal(target(null, -1), null);
  assert.equal(target(null, 1, { x: -100, y: -100 }), 'root');
  assert.equal(target('root', 1, { x: 700, y: 500 }), 'part');
  assert.equal(target('part', 1, { x: -100, y: -100 }, 'inner'), 'inner');
  assert.equal(
    zoomTarget({
      boxes: [],
      current: null,
      direction: 1,
      point: { x: 0, y: 0 },
    }),
    null,
  );
});

test('the map surface asks the model for its expansion', () => {
  for (const zoom of [0.2, 0.66, 0.7, 3, 40])
    assert.deepEqual(
      [...expandedAt(layout, zoom, size)],
      [...expansionAt({ layout, zoom, size })],
    );
  const previous = new Set(['root']);
  assert.deepEqual(
    [...expandedAt(layout, 0.66, size, previous)],
    [...expansionAt({ layout, zoom: 0.66, size, previous })],
  );
});

test('a level is named after the abstraction it reveals', () => {
  assert.deepEqual(namedLevel(graph, []), {
    id: 'system',
    depth: 0,
    container: null,
    kinds: [],
  });
  assert.equal(levelName(copy, namedLevel(graph, [])), copy.wholeSystem);
  // Inside a container the level is what the reader now sees, and where several
  // kinds share it the most abstract of them names it.
  assert.equal(namedLevel(graph, ['root']).id, 'component');
  assert.equal(namedLevel(graph, ['root']).depth, 1);
  assert.equal(
    levelName(copy, namedLevel(graph, ['root'])),
    copy.nodeKinds.component,
  );
  assert.equal(namedLevel(graph, ['mixed']).id, 'subsystem');
  assert.equal(
    levelName(copy, namedLevel(graph, ['mixed'])),
    copy.nodeKinds.subsystem,
  );
  // A leaf holds nothing, so the level a reader standing on it is in is still the
  // one its container opened.
  assert.deepEqual(
    namedLevel(graph, ['root', 'part']),
    namedLevel(graph, ['root']),
  );
  // Every name the levels can carry is a word the strings file already owns.
  for (const key of ['root', 'mixed', 'part'])
    assert.equal(
      typeof levelName(copy, namedLevel(graph, [key])),
      'string',
      key,
    );
});

test('positions accumulate into a return path that never repeats itself', () => {
  const a = { x: 0, y: 0, zoom: 1 };
  const b = { x: 300, y: 120, zoom: 4 };
  assert.deepEqual(pushPosition([], a), [a]);
  assert.deepEqual(pushPosition([a], a), [a]);
  // A sub-pixel drift is the same position, not a new one to return to.
  assert.deepEqual(pushPosition([a], { x: 0.4, y: -0.3, zoom: 1.001 }), [a]);
  assert.deepEqual(pushPosition([a], b), [a, b]);
  assert.equal(previousPosition([]), null);
  assert.equal(previousPosition([a]), null);
  assert.equal(previousPosition([a, b]), a);
  // The stack is bounded, and it is the oldest position that is given up.
  const many = Array.from({ length: 12 }, (_, i) => ({
    x: i * 100,
    y: 0,
    zoom: 1 + i,
  }));
  const stack = many.reduce(
    (history, position) => pushPosition(history, position, { limit: 5 }),
    [],
  );
  assert.equal(stack.length, 5);
  assert.deepEqual(stack, many.slice(-5));
});
