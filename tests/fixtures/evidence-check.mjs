import assert from 'node:assert/strict';
assert.equal(2 + 2, 4);
// The exit status is the fixture's whole point, so it is stated from outside: an
// argument when the command carries one, an environment variable when the command
// must stay byte-for-byte the same across two runs.
process.exitCode = Number(
  process.argv[2] || process.env.EVIDENCE_CHECK_EXIT || 0,
);
