# Shipped assets

These files are the library's versioned contract, packaged into `dist/assets/` and
loaded at runtime by `src/`. They are consumer-facing artifacts, not this project's
own documentation — internal docs live in [docs/project.json](../docs/project.json)
(see the [JSON reading route](../docs/AGENTS.md)).

Invariants:

- Two schemas are current, not one plus a dead one. `model.schema.json`
  (`ProjectModel`, v4) is the authored contract; `architecture.schema.json`
  (`ArchitectureModel`, `version: 3`) is the rendering contract — `projectArchitecture`
  projects every v4 model into that shape before the map draws it, and the same
  schema accepts prior-format input files. Only `legacyCompletion` is
  prior-format-only.
- Changing either schema requires regenerating `contracts.json` and `src/generated/`
  with `npm run generate`, then updating the documentation model and its checks
  together.
- `strings.json` and `project.json` are UI copy for the map and project surfaces —
  not sample models. `strings.json` keeps `"locale":"en"`; plurals are `one`/`other`.
- `authoring.md` and `contract.md` are the only prose files that legitimately ship
  to consumers. Do not add project-internal prose here.
