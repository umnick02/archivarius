# Documentation validators

`project.mjs` passes the built CLI's authoring commands through to
[../project.json](../project.json); `readme.mjs` regenerates the readme and
`site.mjs` serves the local viewer in `viewer/`. Read
[../AGENTS.md](../AGENTS.md) for the editing routes.

Invariants:

- Validation and serving use this repository's own built library
  (`dist/src/cli.mjs`) — do not clone or pin an external framework, and build with
  `npm run build` before running these commands.
- `project.mjs` mirrors the CLI's command surface rather than a shorter list of
  its own; `package.json` decides which of them get an `npm run docs:*` alias.
- The viewer binds to loopback only; it exposes the model endpoint, not the
  repository filesystem.
