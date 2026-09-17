// A claim binds to what it rests on. A binding that names one whole file
// withdraws its record's confirmation on any edit to that file, including an edit
// far away from the lines the claim was ever about. So a binding names the parts
// it rests on — several files, and a range inside a file — and only an edit
// inside one of those ranges withdraws it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingHolds,
  bindingParts,
  movedParts,
  partDigest,
} from '../src/model/binding.mjs';
import { hashBytes } from '../src/model/digest.mjs';
import { assertProject } from '../src/model/project-contract.mjs';
import { ready } from './project-fixture.mjs';

const encode = (text) => new TextEncoder().encode(text);
const source = 'one\ntwo\nthree\nfour\n';
const other = 'alpha\nbeta\n';
const at = (entries) =>
  new Map(entries.map(([path, text]) => [path, encode(text)]));

const ranged = (text, from, to) =>
  hashBytes(
    encode(
      text
        .split('\n')
        .slice(from - 1, to)
        .join('\n'),
    ),
  );

test('a binding reads as the list of parts it rests on', () => {
  // The single-file spelling is one part: the whole of one file.
  assert.deepEqual(bindingParts({ path: 'a.mjs', digest: 'a'.repeat(64) }), [
    {
      path: 'a.mjs',
      digest: 'a'.repeat(64),
      from: undefined,
      to: undefined,
    },
  ]);
  // The general spelling lists them, each with the range it claims.
  assert.deepEqual(
    bindingParts({
      parts: [
        { path: 'a.mjs', digest: 'a'.repeat(64), from: 2, to: 3 },
        { path: 'b.mjs', digest: 'b'.repeat(64) },
      ],
    }),
    [
      { path: 'a.mjs', digest: 'a'.repeat(64), from: 2, to: 3 },
      { path: 'b.mjs', digest: 'b'.repeat(64), from: undefined, to: undefined },
    ],
  );
});

test('a whole-file part digests the bytes and a ranged part digests only its lines', () => {
  const bytes = encode(source);
  assert.equal(partDigest(bytes, { path: 'a.mjs' }), hashBytes(bytes));
  assert.equal(
    partDigest(bytes, { path: 'a.mjs', from: 2, to: 3 }),
    hashBytes(encode('two\nthree')),
  );
  // An open end reads to the end of the file, an open start from its first line.
  assert.equal(
    partDigest(bytes, { path: 'a.mjs', from: 3 }),
    hashBytes(encode('three\nfour\n')),
  );
  assert.equal(
    partDigest(bytes, { path: 'a.mjs', to: 2 }),
    hashBytes(encode('one\ntwo')),
  );
});

test('an edit outside every bound range leaves the binding standing', () => {
  const binding = {
    parts: [
      { path: 'a.mjs', digest: ranged(source, 2, 3), from: 2, to: 3 },
      { path: 'b.mjs', digest: ranged(other, 1, 1), from: 1, to: 1 },
    ],
  };
  assert.equal(
    bindingHolds(
      binding,
      at([
        ['a.mjs', source],
        ['b.mjs', other],
      ]),
    ),
    true,
  );
  // Lines outside both ranges are rewritten: the claim is untouched.
  assert.equal(
    bindingHolds(
      binding,
      at([
        ['a.mjs', 'ONE\ntwo\nthree\nFOUR\nfive\n'],
        ['b.mjs', 'alpha\nBETA\n'],
      ]),
    ),
    true,
  );
  // A line inside a bound range moves: the claim is withdrawn.
  assert.equal(
    bindingHolds(
      binding,
      at([
        ['a.mjs', 'one\nTWO\nthree\nfour\n'],
        ['b.mjs', other],
      ]),
    ),
    false,
  );
});

test('a binding whose file cannot be read at all does not hold', () => {
  const binding = {
    parts: [{ path: 'a.mjs', digest: ranged(source, 1, 1), from: 1, to: 1 }],
  };
  assert.equal(bindingHolds(binding, new Map()), false);
});

test('a binding that claims a range the file no longer has fails by name', () => {
  const part = { path: 'a.mjs', digest: ranged(source, 9, 9), from: 9, to: 9 };
  assert.throws(() => partDigest(encode('one\n'), part), {
    code: 'BINDING_RANGE_MISSING',
  });
  assert.equal(
    bindingHolds({ parts: [part] }, at([['a.mjs', 'one\n']])),
    false,
  );
});

test('the parts that moved are named, and the ones that did not are not', () => {
  const bindings = {
    reader: {
      parts: [{ path: 'a.mjs', digest: ranged(source, 1, 2), from: 1, to: 2 }],
    },
    writer: {
      parts: [{ path: 'a.mjs', digest: ranged(source, 3, 4), from: 3, to: 4 }],
    },
    whole: { path: 'b.mjs', digest: hashBytes(encode(other)) },
  };
  const files = at([
    ['a.mjs', source],
    ['b.mjs', other],
  ]);
  assert.deepEqual(movedParts(bindings, files), []);
  assert.deepEqual(
    movedParts(
      bindings,
      at([
        ['a.mjs', 'one\ntwo\nTHREE\nfour\n'],
        ['b.mjs', other],
      ]),
    ),
    ['writer'],
  );
  // A whole-file binding still answers for the whole file.
  assert.deepEqual(
    movedParts(
      bindings,
      at([
        ['a.mjs', source],
        ['b.mjs', 'alpha\nbeta\ngamma\n'],
      ]),
    ),
    ['whole'],
  );
});

test('the contract accepts a binding that names several files and a range in one', () => {
  const model = ready();
  const key = Object.keys(model.bindings)[0];
  model.bindings[key] = {
    parts: [
      { path: 'fixture.mjs', digest: 'a'.repeat(64), from: 12, to: 40 },
      { path: 'other.mjs', digest: 'b'.repeat(64) },
    ],
  };
  assertProject(model);
  // The single-file spelling every released model uses stays valid beside it.
  model.bindings[key] = { path: 'fixture.mjs', digest: 'a'.repeat(64) };
  assertProject(model);
});
