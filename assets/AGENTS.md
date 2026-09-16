# Shipped assets

These files are the library's versioned contract, packaged into `dist/assets/` and
loaded at runtime by `src/`. They are consumer-facing artifacts, not this project's
own documentation — internal docs live in [project.json](../project.json)
(see the [JSON reading route](../docs/AGENTS.md)).

Invariants:

- Two schemas are current, not one plus a dead one. `model.schema.json`
  (`ProjectModel`, v4) is the authored contract; `architecture.schema.json`
  (`ArchitectureModel`, `version: 3`) is the rendering contract — `projectArchitecture`
  projects every v4 model into that shape before the map draws it, and the same
  schema accepts prior-format input files. Only `legacyCompletion` is
  prior-format-only.
- Changing either schema requires regenerating `src/generated/` with
  `npm run generate`, then updating the documentation model and its checks
  together. `contracts.json` is hand-maintained and read only for prior-format
  input; the v4 panel copy lives in `project.json`.
- `strings.json` and `project.json` are UI copy for the map and project surfaces —
  not sample models. Plurals are `one`/`other`.
- `authoring.md` and `contract.md` are the only prose files that ship to
  consumers. `AGENTS.md` is project-internal and `build.mjs` keeps it out of
  `dist/assets/`. Do not add project-internal prose here.
