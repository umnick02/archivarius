// A layer and a viewport are both projections of one snapshot: the first decides
// which parts and relations exist in the view, the second which of them are worth
// mounting. Both are decided in `model/projection.mjs`, away from React, so the
// 500-part budget `responsive-at-scale` states can be measured in Node.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchitectureGraph } from '../src/model/graph.mjs';
import {
  layerAxis,
  mountedParts,
  projectLayer,
} from '../src/model/projection.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../models/rendering.json', import.meta.url),
    'utf8',
  ),
);
const graph = ArchitectureGraph.validate(model);
const keys = (list) => [...list].sort();
const boundary = (projection, outside, direction) =>
  projection.boundaries.find(
    (edge) => edge.outside === outside && edge.direction === direction,
  );

test('an axis is read from the layer, not guessed by the caller', () => {
  assert.equal(layerAxis('all'), 'all');
  assert.equal(layerAxis('data'), 'kind');
  assert.equal(layerAxis('command'), 'kind');
  assert.equal(layerAxis('state'), 'kind');
  assert.equal(layerAxis('presentation'), 'zone');
  assert.equal(layerAxis('infrastructure'), 'zone');
  assert.equal(layerAxis('external'), 'zone');
  assert.equal(layerAxis('pure'), 'zone');
  assert.throws(() => layerAxis('nonsense'), /UNKNOWN_LAYER/);
});

test('no layer keeps the whole snapshot and states no boundary', () => {
  const projection = projectLayer(model, graph, 'all');
  assert.equal(projection.axis, 'all');
  assert.deepEqual(keys(projection.parts), keys(graph.nodes.keys()));
  assert.deepEqual(
    keys(projection.relations),
    keys(model.relations.map((edge) => edge.key)),
  );
  assert.deepEqual(projection.boundaries, []);
});

test('a zone layer is the parts of that zone with the relations among them', () => {
  const projection = projectLayer(model, graph, 'application');
  assert.equal(projection.axis, 'zone');
  // Only the zone's own parts, and the containers that hold them so the view
  // keeps its shape.
  assert.deepEqual(keys(projection.parts), [
    'engine',
    'gateway',
    'query',
    'search',
  ]);
  assert.deepEqual(keys(projection.relations), ['query-input']);
  // Everything that leaves the zone is named once per outside participant and
  // direction, never drawn as a faded copy of the whole map.
  assert.deepEqual(
    keys(
      projection.boundaries.map((edge) => edge.outside + '/' + edge.direction),
    ),
    [
      'archive/incoming',
      'archive/outgoing',
      'portal/incoming',
      'portal/outgoing',
      'ranking/incoming',
      'ranking/outgoing',
    ],
  );
  assert.deepEqual(
    keys(boundary(projection, 'ranking', 'outgoing').relations),
    ['rank-candidates', 'ranking-input'],
  );
  assert.deepEqual(boundary(projection, 'portal', 'incoming').relations, [
    'search-command',
  ]);
  // A relation between two outside parts belongs to no boundary of this zone.
  assert(
    !projection.boundaries.some((edge) =>
      edge.relations.includes('publication-result'),
    ),
  );
});

test('a kind layer keeps its own relations and only the parts they touch', () => {
  const state = projectLayer(model, graph, 'state');
  assert.equal(state.axis, 'kind');
  assert.deepEqual(keys(state.relations), ['publication-result']);
  assert.deepEqual(keys(state.parts), ['archive', 'publisher']);
  // The relations of another kind that reach out of the projection are a stated
  // boundary, and the ones inside it are simply not drawn.
  assert.deepEqual(keys(state.boundaries.map((edge) => edge.outside)), [
    'query',
    'query',
  ]);
  assert(!state.boundaries.some((edge) => edge.relations.includes('publish')));
  const data = projectLayer(model, graph, 'data');
  assert.deepEqual(keys(data.relations), [
    'candidates',
    'publish',
    'query-input',
    'rank-candidates',
    'ranked',
    'ranking-input',
    'response',
  ]);
  // Every part of this model takes part in a data exchange, so the data view
  // loses nothing — the projection is measured, not assumed.
  assert.deepEqual(keys(data.parts), keys(graph.nodes.keys()));
});

test('the projection never mutates the model it reads', () => {
  const before = JSON.stringify(model);
  projectLayer(model, graph, 'application');
  projectLayer(model, graph, 'data');
  assert.equal(JSON.stringify(model), before);
});

// A flat grid is the worst case for mounting: nothing is nested, so nothing is
// hidden by a closed container and only the viewport can release a part.
const grid = (count, columns = 25) => {
  const nodes = {};
  for (let i = 0; i < count; i++) {
    const key = 'part-' + i;
    nodes[key] = {
      key,
      parent: null,
      x: (i % columns) * 400,
      y: Math.floor(i / columns) * 300,
      width: 320,
      height: 220,
      depth: 0,
      root: key,
    };
  }
  return { nodes, bounds: { x: 0, y: 0, width: columns * 400, height: 6000 } };
};

test('a five-hundred-part model mounts a screenful, not the model', () => {
  const layout = grid(500);
  const visible = Object.keys(layout.nodes);
  const size = { width: 1440, height: 900 };
  const viewport = { x: 0, y: 0, zoom: 1 };
  const mounted = mountedParts({ layout, visible, viewport, size });
  assert.equal(visible.length, 500);
  assert(
    mounted.size < 100,
    'mounted ' + mounted.size + ' of ' + visible.length,
  );
  // What stays is exactly what the viewport and its margin can reach.
  const frame = {
    x: -viewport.x / viewport.zoom - size.width / viewport.zoom,
    y: -viewport.y / viewport.zoom - size.height / viewport.zoom,
    width: (size.width * 3) / viewport.zoom,
    height: (size.height * 3) / viewport.zoom,
  };
  for (const key of mounted) {
    const box = layout.nodes[key];
    assert(
      box.x < frame.x + frame.width &&
        box.x + box.width > frame.x &&
        box.y < frame.y + frame.height &&
        box.y + box.height > frame.y,
      key + ' is mounted outside the frame',
    );
  }
  // Panning releases what it leaves behind and mounts what it arrives at.
  const moved = mountedParts({
    layout,
    visible,
    viewport: { x: -3800, y: -5200, zoom: 1 },
    size,
  });
  assert(moved.size < 100);
  assert.notDeepEqual(keys(moved), keys(mounted));
  assert(!moved.has('part-0'));
});

test('a model that fits the budget keeps every part alive', () => {
  const layout = grid(20);
  const visible = Object.keys(layout.nodes);
  const mounted = mountedParts({
    layout,
    visible,
    viewport: { x: 0, y: 0, zoom: 1 },
    size: { width: 1440, height: 900 },
  });
  // Releasing a part costs a remount; below the budget there is nothing to win,
  // so a small model behaves exactly as it did before virtualization.
  assert.deepEqual(keys(mounted), keys(visible));
});

test('a mounted part always has the container it is drawn inside', () => {
  const layout = grid(500);
  // Nest every second part so a mounted child needs a mounted parent.
  for (let i = 1; i < 500; i += 2) {
    const child = layout.nodes['part-' + i],
      parent = layout.nodes['part-' + (i - 1)];
    child.parent = parent.key;
    child.depth = 1;
    child.root = parent.key;
    child.x = parent.x + 10;
    child.y = parent.y + 10;
    child.width = 120;
    child.height = 80;
  }
  const mounted = mountedParts({
    layout,
    visible: Object.keys(layout.nodes),
    viewport: { x: -2000, y: -1500, zoom: 1 },
    size: { width: 1440, height: 900 },
  });
  assert(mounted.size < 500);
  for (const key of mounted) {
    const parent = layout.nodes[key].parent;
    if (parent) assert(mounted.has(parent), key + ' lost its container');
  }
});
