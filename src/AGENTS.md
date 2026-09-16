# Library source

Read the model through the [JSON reading route](../docs/AGENTS.md) before changing
behavior. `src/` is the whole library across three export modules — `index.jsx`
(browser), `core.mjs` (validation) and `node.mjs` (files/CLI) — each with a
hand-written `.d.ts`/`.d.mts`.

Invariants:

- The browser surface displays validated model facts and keeps only presentation
  state (zoom, focus, selection). Only `node.mjs` touches the filesystem;
  components and `core.mjs` never do I/O, network, SQL or shell.
- Render model content as literal text — no executable Markdown or active-content
  links.
- `generated/` is compiled from `assets/model.schema.json`; regenerate with
  `npm run generate`, never hand-edit it.
- English only: no locale parameter on any export, and `context.jsx` pluralizes
  with `one`/`other` against `assets/strings.json` (`"locale":"en"`).

Co-locate behavior with its owner, add tests in [tests/](../tests/AGENTS.md), and
run `npm test` + `npm run test:browser` from the root.
