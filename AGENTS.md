# Working in Archivarius

Archivarius is a React library that renders architecture maps with semantic zoom,
explicit interactions and a validated JSON contract. It ships a browser component,
a `core` validation surface and a `node` file/CLI surface. All repository
engineering — planning, implementation, documentation, tests and builds — is done
by LLM agents. Read the directory instructions before editing.

## Authority

- [docs/project.json](docs/project.json) is the sole editable documentation model.
  Read focused records through `docs:read`, capture receipts with
  `docs:context --output`, edit with `docs:apply`, and serve the local viewer with
  `docs:serve`. Agents and the viewer read the JSON directly.
  [docs/AGENTS.md](docs/AGENTS.md) owns the reading and editing routes.
- The public API is `src/index.jsx` (browser), `src/core.mjs` (validation) and
  `src/node.mjs` (files/CLI). `assets/model.schema.json` is the versioned contract;
  `src/generated/` holds its compiled validators and types — do not hand-edit them,
  regenerate with `npm run generate`.
- English is the only language. `assets/strings.json` keeps `"locale":"en"`; there
  is no locale parameter on any exported function.
- `README.md` is generated from the documentation model by the library's own `docs`
  command (`npm run docs:readme`), including its Mermaid architecture diagram.
  Never hand-edit it; change `docs/project.json` and regenerate. `npm run check`
  fails on drift, and Prettier ignores it.

## Find the owner

| Subject                                   | Entry point                                | Instructions                                     |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------ |
| Requirements, decisions, plan             | `docs/project.json`                        | [docs/AGENTS.md](docs/AGENTS.md)                 |
| Browser map, mount, panels                | `src/index.jsx`, `src/ArchitectureMap.jsx` | [src/AGENTS.md](src/AGENTS.md)                   |
| Validation, parse, document render        | `src/core.mjs`                             | [src/AGENTS.md](src/AGENTS.md)                   |
| File reads, CLI, project check            | `src/node.mjs`, `src/cli.mjs`              | [src/AGENTS.md](src/AGENTS.md)                   |
| Shipped contract, schemas, strings        | `assets/model.schema.json`                 | [assets/AGENTS.md](assets/AGENTS.md)             |
| Build, contract generation, package check | `tooling/build.mjs`, `tooling/*.mjs`       | [tooling/AGENTS.md](tooling/AGENTS.md)           |
| Tests and consumer fixture                | `tests/*.test.mjs`, `tests/consumer/`      | [tests/AGENTS.md](tests/AGENTS.md)               |
| Documentation validators and viewer       | `docs/scripts/`                            | [docs/scripts/AGENTS.md](docs/scripts/AGENTS.md) |

The browser surface renders model facts and holds only presentation state; only
`src/node.mjs` touches the filesystem. Inspect real consumers and test coverage
before moving or removing a module. No exported component or fixture proves a
supported product behavior on its own.

## Development and verification

Use the Node version in `.nvmrc`; run commands from the repository root.

| Command                              | Scope                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| `npm run build`                      | Compile `src/` and copy `assets/` into `dist/`                   |
| `npm test`                           | Node test suites in `tests/*.test.mjs` (regenerates contract)    |
| `npm run lint`                       | ESLint: hook rules, unused code and the no-I/O module boundary   |
| `npm run test:browser`               | Headless render checks (own Chrome and server; needs `dist`)     |
| `npm run test:package`               | Pack the tarball and validate an installed consumer              |
| `npm run check`                      | Everything above plus `format:check` and `docs:readme:check`     |
| `npm run generate`                   | Regenerate the contract validators/types in `src/generated/`     |
| `npm run docs:validate`              | Validate the whole documentation model                           |
| `npm run docs:read -- --focus <key>` | Read a subject's definitions without edit metadata               |
| `npm run docs:readme`                | Regenerate `README.md` from the model                            |
| `npm run docs:serve`                 | Local documentation viewer at `http://127.0.0.1:4174/`           |
| `npm run format:check`               | Prettier check (`docs/` is ignored; the model is validated JSON) |

## Repository hygiene

Keep instructions concise: no README clones, no prose documentation outside
`docs/project.json`, no stale previews or copied contracts. Historical design is in
Git. Never hand-edit `src/generated/` or `README.md`; regenerate them. Format
before committing.
