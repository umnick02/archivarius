import assert from 'node:assert/strict';
assert.equal(2 + 2, 4);
process.exitCode = Number(process.argv[2] || 0);
