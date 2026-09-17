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
- `artifacts.test.mjs` compiles the shipped schemas the way a consumer does and
  pins their extension surface to `x-targets` and `x-history`; a new `x-` keyword
  must be documented in `contract.md` before the test accepts it.
- `layers.test.mjs` proves the `src/` import graph is a DAG that only points down
  the layers the folders name; move a module instead of widening `allowed`. It also
  holds every described interaction to a dependency the modules really have — fix
  the model or the part-to-file table, never the walk.
- `cdp.mjs` never sleeps for a render: `clicker` waits two frames, `waiter` and
  `settler` wait for state. A suite that needs a sleep is watching the wrong
  signal — the three surviving `pause` calls are polling loops and the one case
  that asserts a key does nothing.
- `npm run test:coverage` holds repository-wide `src/` floors; `ui/view.mjs` is
  proven in the browser suites, which are not instrumented, so read the floors as
  a whole and not per file. `load.test.mjs` covers `ui/load.mjs` in Node by
  stubbing `fetch`, so a network path never depends on Chrome to be exercised.
- `project-fixture.mjs` owns the compact project and the steps that make it
  confirmable; a suite imports it instead of re-reading `models/` or inventing
  its own variant. Project subjects split by owner: completion semantics in
  `project.test.mjs`, rendering in `project-documents.test.mjs`, receipts and
  files in `project-checks.test.mjs`, authoring in `project-authoring.test.mjs`.
