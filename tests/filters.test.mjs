// Filters project the snapshot before the map draws it.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchitectureGraph } from '../src/model/graph.mjs';
import {
  emptyView,
  filterVocabularies,
  filterView,
  keepsPart,
  keepsRelation,
} from '../src/model/address.mjs';
import { relationKinds, zones } from '../src/model/projection.mjs';
import { kindOrder } from '../src/model/zoom.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../models/rendering.json', import.meta.url),
    'utf8',
  ),
);
const graph = ArchitectureGraph.validate(model);
const keys = (list) => [...list].sort();
const filters = (over = {}) => ({ ...emptyView.filters, ...over });

// The vocabularies are read off the contract's own tables, never listed twice.
test('a filter offers exactly the values the contract states', () => {
  assert.deepEqual(filterVocabularies.zone, ['all', ...zones]);
  assert.deepEqual(filterVocabularies.kind, ['all', ...kindOrder]);
  assert.deepEqual(filterVocabularies.relation, ['all', ...relationKinds]);
});

test('no filter keeps the whole snapshot', () => {
  const view = filterView(model, graph, filters());
  assert.equal(view.filtered, false);
  assert.deepEqual(keys(view.parts), keys(graph.nodes.keys()));
  assert.deepEqual(
    keys(view.relations),
    keys(model.relations.map((edge) => edge.key)),
  );
});

test('a zone filter keeps its parts and the containers that hold them', () => {
  const view = filterView(model, graph, filters({ zone: 'pure' }));
  assert.equal(view.filtered, true);
  // `ranking` is the only pure part; `engine` and `search` are the containers it
  // is drawn inside, so the view keeps its shape instead of orphaning a card.
  assert.deepEqual(keys(view.parts), ['engine', 'ranking', 'search']);
  // A relation with one foot outside the view is out of scope, not dimmed.
  assert.deepEqual(keys(view.relations), []);
  assert(keepsPart(filters({ zone: 'pure' }), graph.nodes.get('ranking')));
  assert(!keepsPart(filters({ zone: 'pure' }), graph.nodes.get('portal')));
});

test('a kind filter answers for the kind, not the zone', () => {
  const view = filterView(model, graph, filters({ kind: 'store' }));
  assert.deepEqual(keys(view.parts), ['archive']);
  assert(keepsPart(filters({ kind: 'store' }), graph.nodes.get('archive')));
  assert(!keepsPart(filters({ kind: 'store' }), graph.nodes.get('query')));
  // A container filter keeps the container and, being a container, nothing that
  // is not one.
  assert.deepEqual(
    keys(filterView(model, graph, filters({ kind: 'subsystem' })).parts),
    ['engine', 'search'],
  );
});

test('an interaction filter keeps the exchanges of that kind and their ends', () => {
  const view = filterView(model, graph, filters({ relation: 'state' }));
  assert.deepEqual(keys(view.relations), ['publication-result']);
  assert.deepEqual(keys(view.parts), ['archive', 'publisher']);
  assert(keepsRelation(filters({ relation: 'state' }), { kind: 'state' }));
  assert(!keepsRelation(filters({ relation: 'state' }), { kind: 'data' }));
  assert(keepsRelation(filters(), { kind: 'data' }));
});

// Three filters are one view, not three views drawn on top of each other.
test('filters combine: every one of them has to keep a part', () => {
  const view = filterView(
    model,
    graph,
    filters({ zone: 'application', kind: 'component', relation: 'data' }),
  );
  // `gateway` and `query` are the application components a data exchange joins;
  // `ranking` is pure, `archive` is infrastructure, `portal` is presentation, and
  // `search`/`engine` stay because they are the containers those two are drawn in.
  assert.deepEqual(keys(view.parts), ['engine', 'gateway', 'query', 'search']);
  assert.deepEqual(keys(view.relations), ['query-input']);
  // A combination nothing satisfies is an empty view, not a crash.
  const empty = filterView(
    model,
    graph,
    filters({ zone: 'presentation', kind: 'store' }),
  );
  assert.deepEqual(keys(empty.parts), []);
  assert.deepEqual(keys(empty.relations), []);
});

test('the filter never mutates the model it reads', () => {
  const before = JSON.stringify(model);
  filterView(model, graph, filters({ zone: 'pure', relation: 'data' }));
  assert.equal(JSON.stringify(model), before);
});
