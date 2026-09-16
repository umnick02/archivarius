# Tests

Cases stay beside the behavior they cover; read the
[JSON reading route](../docs/AGENTS.md) before changing what a suite asserts. A
fixture is synthetic scope, never evidence of a supported product behavior, and no
locale is passed to any API under test.

Run `npm test` for `*.test.mjs`, `npm run test:browser` for the headless render
checks, and `npm run test:package` for the packed-tarball consumer in `consumer/`.

Invariant: `artifacts.test.mjs` guards against source leaking into shipped output —
keep that oracle; fix the data, do not weaken the assertion.
