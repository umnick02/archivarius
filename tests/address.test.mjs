// A view a reader reached is a value, not a gesture: it is written into the
// address and read back out of it. The decisions live in `model/address.mjs` so
// the round trip, the per-mount scoping and the rejection of an address that
// names a record the snapshot does not hold can all be measured in Node, with no
// browser and no DOM.
import fs from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ArchitectureGraph } from '../src/model/graph.mjs';
import { failureCodes } from '../src/model/errors.mjs';
import {
  addressFields,
  addressKey,
  addressSnapshot,
  addressFailure,
  checkAddress,
  emptyView,
  surfaceKinds,
  parseAddress,
  writeAddress,
} from '../src/model/address.mjs';

const model = JSON.parse(
  await fs.readFile(
    new URL('../models/rendering.json', import.meta.url),
    'utf8',
  ),
);
const graph = ArchitectureGraph.validate(model);
const snapshot = addressSnapshot(model, graph);

test('an absent address is the view the map opens with', () => {
  assert.deepEqual(parseAddress('', { key: 'first' }), emptyView);
  assert.deepEqual(parseAddress('?', { key: 'first' }), emptyView);
  assert.deepEqual(parseAddress(undefined, { key: 'first' }), emptyView);
  // Nothing the map states is missing from the view it starts in.
  assert.deepEqual(Object.keys(emptyView.filters).sort(), [
    'kind',
    'relation',
    'zone',
  ]);
  assert.deepEqual(writeAddress('', emptyView, { key: 'first' }), '');
});

test('every field of the view survives the round trip', () => {
  const view = {
    ...emptyView,
    at: 'query',
    level: 'engine',
    zoom: 1.25,
    panel: 'node',
    record: null,
    edge: null,
    open: ['options'],
    filters: { zone: 'application', kind: 'component', relation: 'data' },
  };
  const search = writeAddress('', view, { key: 'first' });
  // The address holds what the reader changed and nothing else: a field still at
  // the opening view's value is absent rather than spelled out.
  const held = (state, field) => {
    const value = Object.hasOwn(state.filters, field)
      ? state.filters[field]
      : state[field];
    return Array.isArray(value) ? value.join(',') : value;
  };
  for (const field of addressFields)
    assert.equal(
      search.includes('first.' + field + '='),
      held(view, field) !== held(emptyView, field),
      field + ' is not written the way the view holds it',
    );
  assert.deepEqual(parseAddress(search, { key: 'first' }), view);
});

test('a relation panel is addressed by the interaction it opened', () => {
  const view = {
    ...emptyView,
    panel: 'relation',
    edge: 'query-input',
  };
  const search = writeAddress('', view, { key: 'first' });
  assert.deepEqual(parseAddress(search, { key: 'first' }), view);
});

test('a record panel carries its own key independently of the map selection', () => {
  const view = { ...emptyView, at: 'portal', panel: 'record', record: 'rule' };
  assert.deepEqual(parseAddress(writeAddress('', view)), view);
  const project = { records: [{ key: 'rule' }] };
  assert.deepEqual(
    checkAddress(view, addressSnapshot(model, graph, project)),
    [],
  );
  assert.deepEqual(
    checkAddress(view, snapshot).map(({ code, field }) => ({ code, field })),
    [{ code: 'UNKNOWN_RECORD', field: 'record' }],
  );
});

// Two maps on one page are two views. The address holds both, and neither mount
// reads or overwrites the other's fields.
test('two mounts keep separate views in one address', () => {
  const first = { ...emptyView, at: 'query', panel: 'node' };
  const second = { ...emptyView, at: 'archive', zoom: 2 };
  let search = writeAddress('', first, { key: 'first' });
  search = writeAddress(search, second, { key: 'second' });
  assert.deepEqual(parseAddress(search, { key: 'first' }), first);
  assert.deepEqual(parseAddress(search, { key: 'second' }), second);
  // Moving one map leaves the other where it was.
  const moved = writeAddress(
    search,
    { ...first, at: 'portal', panel: null },
    { key: 'first' },
  );
  assert.deepEqual(parseAddress(moved, { key: 'second' }), second);
  assert.equal(parseAddress(moved, { key: 'first' }).at, 'portal');
});

test('the address keeps what the host page put in it', () => {
  const search = writeAddress(
    '?page=3&q=hello',
    { ...emptyView, at: 'query' },
    { key: 'first' },
  );
  const params = new URLSearchParams(search);
  assert.equal(params.get('page'), '3');
  assert.equal(params.get('q'), 'hello');
  assert.equal(params.get('first.at'), 'query');
  // Clearing the view clears only the map's own fields.
  const cleared = writeAddress(search, emptyView, { key: 'first' });
  assert.equal(new URLSearchParams(cleared).get('q'), 'hello');
  assert.equal(new URLSearchParams(cleared).get('first.at'), null);
});

test('a mount key is derived from the host element, never invented', () => {
  assert.equal(addressKey('first'), 'first');
  assert.equal(addressKey('host maps/2'), 'hostmaps2');
  assert.equal(addressKey(''), 'map');
  assert.equal(addressKey(null), 'map');
  assert.equal(addressKey(undefined), 'map');
});

// A field the map cannot act on is not a failure: the reader is shown the view
// the address does describe rather than an error about a stranger's typo.
test('a value outside the view vocabulary is dropped, not raised', () => {
  const view = parseAddress('?first.panel=nowhere&first.zoom=abc&first.at=', {
    key: 'first',
  });
  assert.equal(view.panel, null);
  assert.equal(view.zoom, null);
  assert.equal(view.at, null);
  assert.equal(parseAddress('?first.zoom=-4', { key: 'first' }).zoom, null);
  assert.equal(parseAddress('?first.zoom=0', { key: 'first' }).zoom, null);
});

test('an address naming a part the snapshot does not hold is rejected', () => {
  const view = { ...emptyView, at: 'ghost' };
  const diagnostics = checkAddress(view, snapshot);
  assert.equal(diagnostics.length, 1);
  const [issue] = diagnostics;
  assert.equal(issue.code, 'UNKNOWN_NODE');
  assert.equal(issue.field, 'at');
  assert.equal(issue.record, 'ghost');
  assert.equal(issue.path, '/at');
  assert(
    issue.value.includes('ghost'),
    'the diagnostic never says what it read',
  );
  assert(issue.expected.length, 'the diagnostic states no accepted shape');
  // The same reading, raised: one code, catalogued, carrying the diagnostics.
  const failure = addressFailure(view, snapshot);
  assert.equal(failure.code, 'UNKNOWN_NODE');
  assert(Object.hasOwn(failureCodes, failure.code));
  assert.deepEqual(failure.diagnostics, diagnostics);
  assert.equal(addressFailure(emptyView, snapshot), null);
});

test('an address naming a level or an interaction that is gone is rejected', () => {
  const level = checkAddress({ ...emptyView, level: 'ghost' }, snapshot);
  assert.deepEqual(
    level.map((issue) => [issue.code, issue.field]),
    [['UNKNOWN_NODE', 'level']],
  );
  const edge = checkAddress(
    { ...emptyView, panel: 'relation', edge: 'ghost' },
    snapshot,
  );
  assert.deepEqual(
    edge.map((issue) => [issue.code, issue.field]),
    [['UNKNOWN_RECORD', 'edge']],
  );
  // A container is a part of the snapshot, so a level may name one.
  assert.deepEqual(
    checkAddress({ ...emptyView, level: 'engine' }, snapshot),
    [],
  );
  assert.deepEqual(
    checkAddress({ ...emptyView, panel: 'relation', edge: 'lookup' }, snapshot),
    [],
  );
});

test('an address naming a filter the contract does not hold is rejected', () => {
  const diagnostics = checkAddress(
    { ...emptyView, filters: { ...emptyView.filters, zone: 'nowhere' } },
    snapshot,
  );
  assert.deepEqual(
    diagnostics.map((issue) => [issue.code, issue.field]),
    [['UNKNOWN_LAYER', 'zone']],
  );
  assert(diagnostics[0].expected.includes('presentation'));
  assert.equal(
    addressFailure(
      { ...emptyView, filters: { ...emptyView.filters, zone: 'nowhere' } },
      snapshot,
    ).code,
    'UNKNOWN_LAYER',
  );
  for (const [field, value] of [
    ['kind', 'widget'],
    ['relation', 'gossip'],
  ])
    assert.equal(
      checkAddress(
        { ...emptyView, filters: { ...emptyView.filters, [field]: value } },
        snapshot,
      )[0].code,
      'UNKNOWN_LAYER',
    );
  // Every filter the contract does hold passes.
  for (const [field, values] of Object.entries({
    zone: ['presentation', 'application', 'infrastructure', 'pure', 'external'],
    kind: ['subsystem', 'component', 'store', 'external'],
    relation: ['data', 'command', 'state'],
  }))
    for (const value of ['all', ...values])
      assert.deepEqual(
        checkAddress(
          { ...emptyView, filters: { ...emptyView.filters, [field]: value } },
          snapshot,
        ),
        [],
        field + ' rejects ' + value,
      );
});

test('the address never mutates the snapshot or the view it reads', () => {
  const view = { ...emptyView, at: 'ghost' };
  const before = JSON.stringify(view);
  checkAddress(view, snapshot);
  addressFailure(view, snapshot);
  writeAddress('', view, { key: 'first' });
  assert.equal(JSON.stringify(view), before);
});

// A surface the reader opened is part of the view: a link that restores the map
// without it hands its receiver a different reading than the sender had.
test('the surfaces a reader opened are carried by the address', () => {
  assert.deepEqual(emptyView.open, []);
  assert.deepEqual(surfaceKinds, ['options']);
  assert.deepEqual(
    parseAddress('first.open=reading,neighbours', { key: 'first' }).open,
    [],
  );
  const view = { ...emptyView, open: ['options'] };
  const search = writeAddress('', view, { key: 'first' });
  assert(search.includes('first.open=options'));
  assert.deepEqual(parseAddress(search, { key: 'first' }), view);
  // Written in one order, read back in one order, so a link is stable.
  assert.deepEqual(
    parseAddress(
      writeAddress(
        '',
        { ...emptyView, open: ['options'] },
        {
          key: 'first',
        },
      ),
      { key: 'first' },
    ).open,
    ['options'],
  );
  // A surface this map has no such thing as is not a surface at all.
  assert.deepEqual(
    parseAddress('first.open=options,ghost', { key: 'first' }).open,
    ['options'],
  );
  assert.deepEqual(parseAddress('first.open=', { key: 'first' }).open, []);
  assert.equal(writeAddress('', emptyView, { key: 'first' }), '');
  for (const name of surfaceKinds)
    assert.deepEqual(
      parseAddress(
        writeAddress('', { ...emptyView, open: [name] }, { key: 'first' }),
        {
          key: 'first',
        },
      ).open,
      [name],
    );
});

test('project workspaces restore the search, record filter and document section', () => {
  const view = {
    ...emptyView,
    panel: 'project',
    view: 'work',
    query: 'export rows',
    recordType: 'task',
    anchor: 'checks',
  };
  assert.deepEqual(parseAddress(writeAddress('', view)), view);
  const besideMap = {
    ...emptyView,
    at: 'writer',
    panel: 'record',
    record: 'implement-export',
    view: 'map',
  };
  assert.deepEqual(parseAddress(writeAddress('', besideMap)), besideMap);
  assert.equal(
    parseAddress('map.view=unknown&map.recordType=unknown').view,
    null,
  );
  assert.equal(
    parseAddress('map.view=unknown&map.recordType=unknown').recordType,
    null,
  );
});
