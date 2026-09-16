# Documentation model

[../project.json](../project.json) is the sole editable documentation source for
Archivarius. Requirements, criteria, decisions, components, interfaces,
interactions, tasks and checks own their definitions; nothing here is prose in
separate Markdown files. Code, agent instructions and actual evidence remain
separate artifacts.

The model is validated and served by this repository's own built library, not a
cloned framework. Build once with `npm run build`, then:

- `npm run docs:validate` — validate the whole snapshot.
- `npm run docs:read -- --focus <key>` — read a subject's applicable
  definitions. `--focus` accepts a record key.
- `npm run docs:context -- --focus <key> --output context.json` — capture an
  edit receipt; stdout stays readable, the file retains the full receipt.
- `npm run docs:apply -- --context context.json --change change.json` — apply a
  validated change. A stale context, unknown field or broken reference is
  rejected and the source file is preserved.
- `npm run docs:bind` — list the parts whose file changed since the last release;
  each name is a description to read against its file again. `docs:bind:check`
  proves every described part is bound to a file that exists, and
  `docs:bind:release` records the current bytes. `docs/scripts/bind.mjs` holds the
  part-to-file table.
- `npm run docs:serve` — start the local viewer at `http://127.0.0.1:4174/`
  (loopback only); reload to read and validate the current JSON, stop with
  Ctrl+C.

| Subject                    | Record key    |
| -------------------------- | ------------- |
| Purpose and scope          | `archivarius` |
| Model and contract         | `model`       |
| Node API and CLI           | `node-api`    |
| Map rendering              | `render`      |
| Replacement/implementation | task keys     |

Edit each rule in its sole owner and update affected criteria, scenarios,
decisions, tasks and checks together. A validated `review` records provenance
and freshness; changing any definition conservatively marks dependent
decisions, tasks and checks as requiring review. Never edit a `basis` by hand.
Structural validity is not semantic correctness or evidence of execution.
