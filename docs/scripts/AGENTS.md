# Documentation validators

`project.mjs` passes the built CLI's authoring commands through to
[../project.json](../project.json); `readme.mjs` regenerates the readme,
`bind.mjs` recomputes the bindings of the described parts and `site.mjs` serves
the local viewer in `viewer/`. Read
[../AGENTS.md](../AGENTS.md) for the editing routes.

Invariants:

- Validation and serving use this repository's own built library
  (`dist/src/cli.mjs`) — do not clone or pin an external framework, and build with
  `npm run build` before running these commands.
- `project.mjs` mirrors the CLI's command surface rather than a shorter list of
  its own; `package.json` decides which of them get an `npm run docs:*` alias.
- The viewer binds to loopback only; it exposes the model endpoint, not the
  repository filesystem.
- `bind.mjs` owns the only hand-maintained part-to-file table; digests are read
  from disk, never written by hand. `--check` proves the table covers the
  described parts and that every bound file exists, `--release` records the
  current bytes, and the default run lists the parts whose bytes moved since that
  release — a reading list, not a failure. The readme shows a part only while that
  table binds it.
