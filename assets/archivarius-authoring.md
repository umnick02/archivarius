# Project artifact for the LLM

Source — JSON v4 per `archivarius/model.schema.json`.
Example: `archivarius/example.json`. Change: `archivarius/assets/change.schema.json`.

1. Obtain context: `archivarius context project.json --focus task-key`.
   Save the response as `context.json`. It contains the exact records and read
   revisions. `omitted` shows how many records were left out of the selection.
   `documents` contains the sections in which the selected subject is defined, including
   nested changes, tests, and the task's exit conditions. These are excerpts for reading;
   to modify the document itself, request context with its key.
2. Prepare `change.json`: `put` contains the wholly new or changed records,
   `remove` — the keys of records to delete. `bindings` replaces the declared bindings.
   The key is preserved on rename.
   Do not copy rules into tasks: use `covers`, `uses`, `affects`.
3. Substantively re-review the affected decisions, tasks, and check definitions.
   List their keys in `review`, and the analysis result in `reason`.
   Do not compute or rewrite `basis` by hand.
4. Apply: `archivarius apply project.json --context context.json --change change.json`.
   Stale context, an unknown field, and a broken reference are rejected.
   On rejection the source file is preserved. Obtain new context and resolve the conflict.
5. Validate the whole: `archivarius validate project.json --json`.
   Validity permits open questions and coverage gaps.

A record's definition is short and precise; conditions and exceptions are preserved in full.
A criterion references a requirement. A shared parameter is defined once at the requirement.
The text of a scenario or check uses this definition. Applicability to a scope
extends to its composition. A requirement without implementation remains a visible gap.

`implemented` is absent from the v4 input. Executing a check requires its explicit
`command`; it is run only by the `archivarius run` command, never on loading the
model. `bindings` records the files of the implementation, the check, and the material inputs.
`run` records the actual outcome, the command, the versions, and the log; `verify` reads
the artifacts and matches their bytes. Do not create successful results by hand.

Status is computed: `confirmed` — the entire described scope is confirmed, `partial` —
there are current confirmed criteria and gaps remain, `unconfirmed` — no such
confirmations exist. Do not add these fields or percentages to the JSON records. Criteria
must express self-contained verifiable assertions; do not split them for the sake of a counter.
All of a criterion's unit checks must have a current successful confirmation. If
there are no unit checks, the covering integration checks are used. A negative,
unresolved outcome of any covering check refutes the criterion; a full implementation
of a component or scope additionally requires a check of the whole.

Gaps propagate through composition, applicable requirements, interaction contracts,
and explicitly assigned decisions/tasks with their dependencies. Adjacency on the map by itself
does not carry all of one component's gaps over to another. A scope accounts for its entire
composition, including unassigned requirements and questions. Code, tests, and evidence remain
in separate files; the definitions of requirements, decisions, and tasks are stored in JSON once.

When a file changes, update its binding in the new agreed snapshot. Changes
to an arbitrary external environment, the completeness of `bindings`, and the meaning of assertions require
verification over the course of the project: JSON Schema does not prove them.

Markdown is an optional export for reading. The LLM edits the JSON records.
A `document` record holds the structure of sections, lists, tables, and examples. The text
of a rule or task in a document is replaced by a `{record, field}` reference, so that
changing a definition updates all of its representations. JSON documents also
support such references; `as: "labels"` outputs stable record labels.
Do not copy a rule's text into a paragraph if it already belongs to another record.
A requirement's `companions` and `guards` set the related context; `guards` are additionally
counted as mandatory constraints upon confirmation.
`archivarius documents project.json --output .` generates the package; the same command
with `--check` rejects a missing or manually changed file. Relative paths
cannot leave the destination directory or pass through symbolic links.
Documents are not evidence of implementation. Existing reports and code
remain separate files with their own bases and checks.

History and the manifests of prior snapshots are preserved on `apply`; they cannot be deleted
for the sake of restoring currency. Changing any definition still conservatively
re-reviews the bases of the entire project. Prior v3 maps are supported for viewing,
their manual marks are not v4 confirmations.

In a Git repository, `archivarius git-history project.json` moves history storage
to committed versions of the model. Commit the complete model and any existing
`.history/` segments first. The command validates that migration is lossless;
it does not commit, stage or delete files. After it succeeds, remove the old
segments from the working tree and commit that removal with the updated model.
Normal reads and edits then resolve prior versions through Git. Keep the
referenced commits available: a shallow clone or a standalone JSON copy is not
sufficient. Multiple uncommitted edits retain their intermediate revisions in
the JSON; the next apply after committing absorbs that pending history into
Git. Use `git log -- project.json` and `git show <commit>:project.json` to inspect
committed changes.
