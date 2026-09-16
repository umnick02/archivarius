# Tests

Cases stay beside the behavior they cover; read the
[JSON reading route](../docs/AGENTS.md) before changing what a suite asserts.

Run `npm test` for `*.test.mjs`, `npm run test:browser` for the headless render
checks, and `npm run test:package` for the packed-tarball consumer in `consumer/`.
`harness.mjs` owns the render environment: it serves the packed consumer build on
an ephemeral port and drives a private headless Chrome (`CHROME_PATH` overrides
discovery), so the suites need `test:package` first and never a manual browser or
a fixed port.

Invariants:

- `artifacts.test.mjs` guards against source leaking into shipped output — keep
  that oracle; fix the data, do not weaken the assertion.
- `types.test.mjs` holds the hand-written declarations to the modules they
  describe; declare a new export instead of relaxing the parity assertion.
- `layout.test.mjs` proves ELK determinism through the uncached `buildLayout`
  option; the memoized path must never be the only one exercised.
- `layers.test.mjs` proves the `src/` import graph is a DAG that only points down
  the layers the folders name; move a module instead of widening `allowed`.
