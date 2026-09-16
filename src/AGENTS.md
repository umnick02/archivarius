# Library source

Read the model through the [JSON reading route](../docs/AGENTS.md) before changing
behavior. Three export modules stay at the root of `src/` because
`package.json` maps them to `dist/src/`: `index.jsx` (browser), `core.mjs`
(validation) and `node.mjs` (files/CLI), plus the `cli.mjs` binary and the
hand-written `.d.ts`/`.d.mts` beside them. Everything else lives in a folder that
names its layer:

| Folder       | Contents                                                       | May do I/O |
| ------------ | -------------------------------------------------------------- | ---------- |
| `ui/`        | React components, presentation state, `load.mjs`, `styles.css` | no         |
| `model/`     | Contract, graph, analysis, document rendering                  | no         |
| `io/`        | Filesystem readers/writers behind `node.mjs`                   | yes        |
| `layout/`    | ELK geometry, loaded lazily by `ui/load.mjs`                   | no         |
| `generated/` | Compiled from `assets/model.schema.json`                       | no         |

Invariants:

- ESLint bans `node:*` and `process` for all of `src/**` and re-allows them only
  for `src/io/**`, `src/node.mjs` and `src/cli.mjs`; it also forbids reaching into
  `io/` from anywhere else. Move a module instead of widening the rule.
- Imports only point down this table and never form a cycle, and a module inside a
  layer imports its owner directly rather than an entry point.
  `tests/layers.test.mjs` holds both.
- The root modules are export surfaces: behavior lives in a layer, so `core.mjs`
  re-exports `model/parse.mjs` instead of holding the parser.
- The browser surface displays validated model facts and keeps only presentation
  state (zoom, focus, selection). `ui/load.mjs` is the sole `fetch` caller.
- Render model content as literal text — no executable Markdown or active-content
  links.
- `generated/` is compiled from `assets/model.schema.json`; regenerate with
  `npm run generate`, never hand-edit it.
- `model/project-document.mjs` generates the architecture diagram from the
  `component` and `interaction` records; there is no hand-drawn second copy of the
  graph.
- English only: no locale parameter on any export, and `ui/context.jsx` pluralizes
  with `one`/`other` against `assets/strings.json` (`"locale":"en"`).

Co-locate behavior with its owner, add tests in [tests/](../tests/AGENTS.md), and
run `npm test` + `npm run test:browser` from the root.
