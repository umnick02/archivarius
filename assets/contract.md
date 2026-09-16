# Contract v4

Exact structure: `model.schema.json`; edit input: `change.schema.json`.
If the architecture has not yet been studied, `entry: null` and the absence of components allow
browsing requirements and other records. The first added components must already
form a connected interaction with a concrete entry. An unused exchange
contract remains a visible gap; its participants need not be invented.
Types and the structural validator are generated from the schemas. `x-targets` defines the allowed
endpoint types of references; `x-history` permits a reference to a stored historical record.

| Data            | Purpose                                                                        |
| --------------- | ------------------------------------------------------------------------------ |
| `records`       | Current definitions with unique `key` and `type`                               |
| `root`, `entry` | Root scope and the terminal participant of the entry into the architecture     |
| `bindings`      | Named relative paths and SHA-256 of realization, verification, and entry files |
| `history`       | Former records with a verifiable content hash                                  |
| `snapshots`     | The exact composition of used revisions and bindings of a former snapshot      |

`scope` groups a product area; `component.parent` defines architectural
nesting. `interaction` connects terminal components through an `interface`.
Shared exchange contracts are defined once. All components are connected to the entry,
exposed subsystems have external interaction, terminal participants are `boundary`.
Nesting, task order, and decision bases do not permit cycles; runtime exchange
may contain feedback. The current `decision` choice is unique by `scope + topic`.

A requirement owns `rule`, `when`, `exceptions`, and optional `parameters`.
An optional `label` preserves the external designation of a record. A requirement's `category`
distinguishes product rules, exceptions, architecture, and presentation.
`companions` defines neighboring requirements to read; `guards` — mandatory
constraints participating both in the context and in the confirmation output.
`appliesTo` defines applicability; `sources` — the bases. A criterion is linked through
`requirement`. A task specifies `change`, `affects`, `covers`, `needs`, `uses`.
A verification defines `method`, `covers`, `scenarios`, `targets`, `level`, and, when an
executable check is present, an array of `command` arguments. Loading data does not run the command.

`basis.contract` — SHA-256 of the canonical representation of definitions: object keys
are sorted, record order is normalized, array order within a record is significant.
Results, history, `basis`, and the review text are excluded from the computation.
All other changes, including adding a requirement, invalidate currency.
The verification scope is still the whole project: this is a conservative safeguard when the completeness
of dependencies is unknown. `result.realization` separately records the exact `bindings`.

A change via the API requires an unchanged context; a partial write does not replace the file.
`apply` preserves history and the manifest, while `review` requires a substantive explanation.
Results are immutable. A removed negative result with an applicable basis
remains an obstacle. Resolution of a contradiction is specified explicitly through `resolves` and
`resolution`; it is taken into account only with available successful evidence.

Full realization is derived from all applicable criteria, the assigned realization,
current bases, required verifications, and verification of the whole. Questions, assumptions,
uncovered requirements, missing bindings, and contradictions preclude a "yes".
For confirmation, a result must have an available execution artifact and matching
bytes of all declared inputs. Loading from a `File`/object does not grant access to neighboring
files, and therefore by itself does not confirm execution.

Hashes detect discrepancies but do not certify the author's identity. The process owner
trusts the executor of verifications and the completeness of declared inputs. A package does not prove the meaning
of arbitrary text, the completeness of tests, or the absence of undeclared dependencies.
`analyzeProject(..., {verifiedResults})` — a low-level trust boundary for its own
verifying adapter; an ordinary Node consumer uses `verifyProjectFiles()`.

The browser reads bindings and evidence by relative URLs next to the model.
Paths outside the directory and external origins are not supported. Confirmation pertains to the loaded
snapshot; after changing the model or artifacts, a reload must be performed.
Markdown reproduces definitions and recorded bases; live verification of files
is performed by `verify`, not by document export.

`document` stores `stage`, a relative `path`, and `format`. For Markdown, `blocks`
contains headings, paragraphs, lists, tables, quotes, code, comments, and anchors.
A line's content is an array of strings and references `{record, field, index?}` to string
fields of definitions. `index` selects an array element. Cyclic inclusion of
documents is not supported. In the JSON format, `data` stores an object with the same
references; they may also select numbers, objects, and arrays. `as: "labels"`
replaces keys with their associated external designations. An object with `record` and `field`
is reserved for a reference; additional unknown fields are rejected.
`subjects` links a technical document to its subjects. Documents are counted
in the definitions hash but do not add realization obligations or proofs.
`documents --check` verifies exact matching of files with a fresh render.
