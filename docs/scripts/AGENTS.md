# Documentation validators

`project.mjs` owns the authoring commands (`validate`, `read`, `context`, `apply`,
`serve`) over [../project.json](../project.json); `site.mjs` serves the local
viewer in `viewer/`. Read [../AGENTS.md](../AGENTS.md) for the editing routes.

Invariants:

- Validation and serving use this repository's own built library
  (`dist/src/cli.mjs`) — do not clone or pin an external framework, and build with
  `npm run build` before running these commands.
- The viewer binds to loopback only (`http://127.0.0.1:4174/`); it exposes the
  model endpoint, not the repository filesystem.
- Keep project prose in the JSON model, not in these scripts or in fixtures.
