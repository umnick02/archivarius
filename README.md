# Archivarius

A library for architecture maps with semantic zoom and linked project records.
A single JSON v4 holds architecture, requirements, decisions, scenarios, tasks, and checks.
Zooming in reveals components and specific interactions;
the geometry stays fixed. The **"Project"** button opens an overview of the structure,
requirements and decisions, remaining work, and confirmations. Global search finds
names, parameters, conditions, and check contents; the full registry is also available.

[Sample data](examples/basic/public/project.json) ·
[JSON Schema](assets/model.schema.json) ·
[Contract rules](assets/contract.md) ·
[LLM workflow](assets/authoring.md)

Project data and UI labels remain external resources. The format does not depend on the language,
repository, or build of the project. You do not need to supply coordinates. Older v3 maps
keep opening under [their own schema](assets/legacy.schema.json); their manual marks
are not carried over into the computed v4 confirmation.

## Installation

The package is installed from Git; it is not published to the npm registry:

```sh
npm install git+ssh://git@github.com/umnick02/archivarius.git react@19 react-dom@19
```

To install without running scripts, build a tarball inside a clone:

```sh
npm ci --ignore-scripts
npm run build
npm pack --ignore-scripts
```

Install the resulting `.tgz` into your project. This is an ESM package for a browser bundler;
React 19 and Vite 8 are verified. The container must have a non-zero size.

```js
import { mountArchitectureMap } from 'archivarius';
import 'archivarius/style.css';

const map = mountArchitectureMap(document.getElementById('map'), {
  source: '/project.json',
});
await map.ready;
await map.focus(componentKey);
map.inspect(requirementKey);
```

`source` accepts a URL, `File`, `Blob`, or a parsed object. The container must be
empty. `load(source)` replaces the model, `home()` returns to the overview, `snapshot()`
returns the navigation state, `destroy()` releases the container. An unfinished
load that gets replaced is rejected with `AbortError`. Handle the rejection of `ready`;
`onError` receives the error, which is also shown in the map.

The React component exposes the same methods through a `ref`:

```jsx
import { ArchitectureMap } from 'archivarius';
import 'archivarius/style.css';

export function ProjectMap() {
  return <ArchitectureMap source="/project.json" style={{ height: 720 }} />;
}
```

Multiple instances have independent navigation and handlers. Styles are scoped to
`.archivarius`; the layout adapts to the container width. The language of the records
themselves is preserved. Keep the reference to the `source` object stable across renders,
as long as its data does not change.

## Records and confirmation

| Data                   | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `records`              | Compact definitions with keys and typed references               |
| `root`, `entry`        | Project scope and entry component                                |
| `bindings`             | Paths and SHA-256 of implementation, checks, and material inputs |
| `history`, `snapshots` | Prior records and the exact set of revisions used                |

A requirement defines a rule once; criteria, tasks, and checks reference
it. Components are linked by meaningful interactions. Requirements without an
implementation and open questions appear in the project overview. The UI shows brief cards;
the rationale, reasons for a missing confirmation, and history are revealed on demand.
"Back" restores the card, filter, and list position. On a wide screen the
panel occupies a separate area; on a narrow one you can switch between the map and the card.
`F6` moves focus between the map and the panel, `Esc` closes the panel.
Incoming and outgoing links that share a label, external participant, type, and channel
are collected into an expandable group with a counter. Inside you can see the individual participants,
the data exchanged, and jumps to each source contract.
The map always shows three implementation marks: a green check — fully
confirmed, an amber half-circle — partially, an empty gray circle — no confirmations.
Area colors and line types keep their meaning. A shared arrow is fully confirmed
only when all of its links are confirmed; the presence of a confirmed link or a partial
confirmation yields a partial result. The card and the map use the same calculation.

The v4 input has no manual status or completion percentage. `analyzeProject` returns
`completion[key].state`: `confirmed`, `partial`, or `unconfirmed`; the former
`implemented` is `true` only for `confirmed`. `progress.criteria` and
`progress.confirmedCriteria` list the criteria and the confirmed part without
recounting the total criteria. Their ratio is not a completion percentage.

A component's result accounts for the applicable requirements, its composition, internal and boundary
interactions, assigned decisions, and tasks with their explicit dependencies. An interaction
depends on its own contract but does not inherit all the gaps of a neighboring component. An area
aggregates its composition; an unassigned question remains a gap of the area. A requirement
without criteria blocks full confirmation, even if other criteria are met.

Partial confirmation requires at least one current verified criterion.
If unit checks are defined for a criterion, all of them must pass;
otherwise, covering integration checks are used. An unresolved
negative result from any covering check refutes the criterion. For full
confirmation of a component or area, an integration check of the whole is additionally required.
That is why all criteria may be confirmed while the result stays partial.

The new `review` stores `basis.dependencies`: a fingerprint of the definition, its explicit
dependencies, inherited area constraints, owner sections, and `governedBy` documents.
Changes to these inputs require a review; names and independent
records do not. For tasks, local scope is set by `covers`/`uses`, for checks by
`covers`/`scenarios`; shared area rules are added automatically.
Prior bases without a fingerprint stay conservative until an explicit `review`.
Execution results still require an exact, complete `basis.contract`. The shown result refers to the loaded snapshot; after changes a
reload is required. The absence of confirmations does not prove the absence of code.

## LLM workflow and checks

```sh
archivarius validate project.json --json
archivarius read project.json --focus task-key
archivarius context project.json --focus task-key --output context.json
archivarius archive project.json
archivarius apply project.json --context context.json --change change.json
archivarius run project.json --focus check-key --result run-key --evidence evidence/run.json
archivarius verify project.json
```

The LLM returns JSON per the [change schema](assets/change.schema.json): `put`, `remove`,
`review`, `reason`. `apply` verifies the source context, preserves prior revisions,
and replaces the file atomically. Independent edits are allowed against the original receipt;
changed records, documents, or a changed set of read dependencies are rejected. Structural errors include a JSON Pointer for the fix.
Unknown fields and invalid references are rejected. A valid incomplete model
can be viewed but is not considered fully implemented.

`read` emits definitions and owner sections without the receipt and repeated
review bases. `context --output` saves the full receipt to a file,
while the response shows the same readable context. Add `governedBy` for
documents whose rules apply beyond the owner section of a record.

`archive` stores all historical revisions in the adjacent directory
`project.json.history/`. The current JSON holds the prior current records and
the archive head hash. Subsequent applies append immutable segments;
the pointer switches after a segment is written. Keep the directory in Git together
with the model. `readArchitectureFile` verifies the hashes and reconstructs the full model;
pass this result to the browser. Pure APIs without a filesystem reject
an unexpanded archive. A lost or altered segment raises an error.

`run` explicitly runs the `command` recorded in a check and saves the actual outcome,
command, versions, and log. A plain JSON load executes nothing. `verify`
checks the bytes of the declared files and evidence; on incomplete confirmation it
exits with code 1. The completeness of the declared inputs and the meaning of the checks remain
the responsibility of the project's process. Hashes do not attest the author of an artifact.

The core API without React and DOM:

```js
import {
  parseArchitecture,
  validateProject,
  projectContext,
  applyProjectChanges,
} from 'archivarius/core';
import {
  readArchitectureFile,
  verifyProjectFiles,
  updateProjectFile,
} from 'archivarius/node';
```

`analyzeProject` computes the reasons and results; `verifyProjectFiles(model, directory)`
provides verified results. The manually passed `verifiedResults` is the
trust boundary for your own check adapter, not a field of the input JSON.

Markdown is an optional reproducible representation:

```sh
archivarius docs project.json --output project.md
archivarius docs project.json --output project.md --check
```

For a full documentation package, use `document` records with relative
paths and structured blocks. Requirements, criteria, decisions, and tasks
are inserted as references to their fields; tables and explanations belong to the document.
Markdown and JSON indexes become reproducible representations:

```sh
archivarius documents project.json --output .
archivarius documents project.json --output . --check
```

API: `renderDocument` from `archivarius/core`, `exportProjectDocuments` from
`archivarius/node`. In the UI, the "Documentation" section expands the content by sections.
Details of the structure and editing rules are in the [contract](assets/contract.md).

Export is also available in the UI via "How to read the map". Its definitions, references, and
recorded bases are taken from the loaded JSON. It does not replace a live verification of the
files with the `verify` command and is not edited as a second source.

## Hosting and development

A model loaded by URL is read via `fetch`, `File`, and `Blob` — locally. The library does not
send data to a server. In URL mode, bindings and evidence are read next to
the model; from a single `File` there is no access to neighboring files, so such
opening does not by itself confirm completion.

The JSON Schema, sample, and instructions are exported as `archivarius/model.schema.json`,
`archivarius/example.json`, `archivarius/assets/authoring.md`. With a non-standard
bundler, preserve `dist/assets/` and pass `assetsBaseUrl`. The whole directory is needed
for the localization of the map, project, and rules. ELK loads separately; the layout
is computed when the model loads, on the browser's main thread.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

`check` builds the package, validates the model, changes, evidence, geometry, and
assets, then installs the tarball and builds a separate consumer with type
checking. `test:browser` uses the consumer preview on 44891 and Chrome CDP on 44890.
Schemas generate validators and types into the ignored `src/generated/`.

Foundation: [React Flow](https://reactflow.dev/api-reference/react-flow-provider),
[ELK.js](https://github.com/kieler/elkjs), [AJV](https://ajv.js.org/standalone.html),
[noble-hashes](https://github.com/paulmillr/noble-hashes).
