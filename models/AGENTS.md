# Demo models

Two authored models, one per contract. They are the fixture every suite reads and
the file the example page serves — one copy, never a per-suite variant.

| File                 | Contract                                        | Read by                                                                                         |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `documentation.json` | `assets/model.schema.json` (`ProjectModel`, v4) | `tests/project-fixture.mjs`, project suites, `tooling/build.mjs` → `dist/example.json`          |
| `rendering.json`     | `assets/architecture.schema.json` (v3)          | `tests/browser.mjs`, `model.test.mjs`, `load.test.mjs`, `layout.test.mjs`, `documents.test.mjs` |

Invariants:

- Neither file is this repository's own documentation — that is
  [../project.json](../project.json). Nothing here is generated.
- `documentation.json` ships as `archivarius/example.json`; editing it changes a
  published artifact and every project suite at once.
- `rendering.json` exercises what the documentation model has none of: a store, an
  outside participant and every relation kind. Keep that coverage.
- `examples/basic/vite.config.mjs` serves this directory as its `publicDir`, so a
  new file here is reachable from the example without a copy.
