# Shipped assets

These files are the library's versioned contract, packaged into `dist/assets/` and
loaded at runtime by `src/`. They are consumer-facing artifacts, not this project's
own documentation — internal docs live in [docs/project.json](../docs/project.json)
(see the [JSON reading route](../docs/AGENTS.md)).

Invariants:

- Changing `model.schema.json` requires regenerating `contracts.json` and
  `src/generated/` with `npm run generate`, then updating the documentation model
  and its checks together.
- `authoring.md` and `contract.md` are the only prose files that legitimately ship
  to consumers. Do not add project-internal prose here.
- `strings.json` keeps `"locale":"en"`; plurals are `one`/`other`.
