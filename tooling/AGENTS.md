# Development tooling

`package.json` owns public commands; these scripts implement build, contract
generation and the packaged-consumer check. Read the
[JSON reading route](../docs/AGENTS.md) before changing what they enforce.

Invariants:

- `generate-contract.mjs` is the sole writer of `src/generated/` and
  `assets/contracts.json` (via `npm run generate`, also the `pretest` hook). Never
  hand-edit its outputs.
- `test-package.mjs` packs the real tarball and asserts its file allowlist: only
  `dist/` and `package.json` ship (no README). Keep that allowlist in sync with
  `package.json` `files`.
- Fix violating code rather than weakening a check.
