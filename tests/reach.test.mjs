// Where a change reaches. A reader picks a part and asks what it touches, what
// touches it, whether two parts are connected at all and whether the arrows come
// back round. The answers are read from the relations as recorded, so a part the
// relations never mention is reported as unknown rather than as reaching nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reach, pathBetween } from '../src/model/reach.mjs';

// A line: reader -> parse -> store, and a branch off parse.
const line = [
  { key: 'r1', from: 'reader', to: 'parse', kind: 'data' },
  { key: 'r2', from: 'parse', to: 'store', kind: 'data' },
  { key: 'r3', from: 'parse', to: 'log', kind: 'state' },
];

// A loop: queue -> worker -> queue, entered from a producer.
const loop = [
  { key: 'q1', from: 'producer', to: 'queue', kind: 'command' },
  { key: 'q2', from: 'queue', to: 'worker', kind: 'command' },
  { key: 'q3', from: 'worker', to: 'queue', kind: 'state' },
];

test('reach follows the arrows past the first hop', () => {
  const answer = reach(line, 'reader');
  assert.equal(answer.known, true);
  assert.deepEqual(
    answer.downstream.map(({ part, distance }) => [part, distance]),
    [
      ['parse', 1],
      ['log', 2],
      ['store', 2],
    ],
  );
  assert.deepEqual(answer.upstream, []);
});

test('what reaches a part is read against the arrows', () => {
  const answer = reach(line, 'store');
  assert.deepEqual(
    answer.upstream.map(({ part, distance }) => [part, distance]),
    [
      ['parse', 1],
      ['reader', 2],
    ],
  );
  assert.deepEqual(answer.downstream, []);
});

test('a part the relations never mention is unknown, not unconnected', () => {
  const answer = reach(line, 'absent');
  assert.deepEqual(answer, {
    part: 'absent',
    known: false,
    downstream: [],
    upstream: [],
    cycles: [],
  });
});

test('the parts that reach each other are named as one loop', () => {
  const answer = reach(loop, 'producer');
  assert.deepEqual(answer.cycles, [
    {
      parts: ['queue', 'worker'],
      loop: ['queue', 'worker'],
      relations: ['q2', 'q3'],
    },
  ]);
  // The producer is not in the loop, so its own reach still names both members.
  assert.deepEqual(
    answer.downstream.map(({ part }) => part),
    ['queue', 'worker'],
  );
});

test('a loop is one loop whichever member is asked', () => {
  const asked = ['producer', 'queue', 'worker'].map(
    (part) => reach(loop, part).cycles,
  );
  assert.deepEqual(asked[1], asked[0]);
  assert.deepEqual(asked[2], asked[0]);
});

test('a part inside a loop reaches itself', () => {
  const answer = reach(loop, 'queue');
  assert.deepEqual(
    answer.downstream.map(({ part, distance }) => [part, distance]),
    [
      ['worker', 1],
      ['queue', 2],
    ],
  );
});

test('a part that only relates to itself is its own loop', () => {
  const answer = reach([{ key: 's', from: 'echo', to: 'echo' }], 'echo');
  assert.deepEqual(answer.cycles, [
    { parts: ['echo'], loop: ['echo'], relations: ['s'] },
  ]);
});

test('a loop nobody in the reach touches is not reported', () => {
  const relations = [
    ...line,
    { key: 'x1', from: 'alpha', to: 'beta' },
    { key: 'x2', from: 'beta', to: 'alpha' },
  ];
  assert.deepEqual(reach(relations, 'reader').cycles, []);
  assert.deepEqual(
    reach(relations, 'alpha').cycles.map(({ parts }) => parts),
    [['alpha', 'beta']],
  );
});

// A block is a part too: a reader selecting a subsystem asks what a change inside
// it touches outside it. The members answer as one, and what stays inside the
// block is not reported as reach.
test('a block reaches what its members reach outside it', () => {
  const answer = reach(loop, 'engine', ['queue', 'worker']);
  assert.equal(answer.known, true);
  assert.deepEqual(answer.downstream, []);
  assert.deepEqual(
    answer.upstream.map(({ part, distance }) => [part, distance]),
    [['producer', 1]],
  );
  // The loop inside the block is still the loop it is, named among its members.
  assert.deepEqual(
    answer.cycles.map(({ parts }) => parts),
    [['queue', 'worker']],
  );
});

test('a block whose members touch nothing is unknown', () => {
  assert.equal(reach(line, 'block', ['absent', 'missing']).known, false);
});

test('the path between two parts is the shortest way there', () => {
  const relations = [
    ...line,
    { key: 'shortcut', from: 'reader', to: 'store', kind: 'data' },
  ];
  assert.deepEqual(pathBetween(line, 'reader', 'store'), {
    parts: ['reader', 'parse', 'store'],
    relations: ['r1', 'r2'],
  });
  assert.deepEqual(pathBetween(relations, 'reader', 'store'), {
    parts: ['reader', 'store'],
    relations: ['shortcut'],
  });
});

test('a path out of a block starts at the member that gets there first', () => {
  const relations = [
    { key: 'a', from: 'near', to: 'edge' },
    { key: 'b', from: 'far', to: 'middle' },
    { key: 'c', from: 'middle', to: 'edge' },
  ];
  assert.deepEqual(pathBetween(relations, ['far', 'near'], 'edge'), {
    parts: ['near', 'edge'],
    relations: ['a'],
  });
  // A block that contains the target has no way out to it: it is already inside.
  assert.equal(pathBetween(relations, ['near', 'edge'], 'edge'), null);
  // And the way into a block ends at the member reached first.
  assert.deepEqual(pathBetween(relations, 'far', ['edge', 'near']), {
    parts: ['far', 'middle', 'edge'],
    relations: ['b', 'c'],
  });
  assert.equal(pathBetween(relations, 'far', []), null);
});

test('a path runs the way the arrows point and no other way', () => {
  assert.equal(pathBetween(line, 'store', 'reader'), null);
  assert.equal(pathBetween(line, 'store', 'log'), null);
});

test('a part is no path to itself', () => {
  assert.equal(pathBetween(line, 'parse', 'parse'), null);
  assert.equal(pathBetween(line, 'absent', 'parse'), null);
  assert.equal(pathBetween(line, 'parse', 'absent'), null);
});

test('the reported answer does not depend on the order the relations arrive', () => {
  const shuffled = [line[2], line[0], line[1]];
  assert.deepEqual(reach(shuffled, 'reader'), reach(line, 'reader'));
  assert.deepEqual(
    pathBetween(shuffled, 'reader', 'store'),
    pathBetween(line, 'reader', 'store'),
  );
});
