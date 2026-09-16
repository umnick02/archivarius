# Archivarius

Confirmation applies to this contract and accessible check artifacts. Reload after data changes.

Snapshot: `be5d59cf1874d0f48d3c95092dc8488e0bac4abde9725121d4d65179070caae2`

```mermaid
flowchart TD
    subgraph model["Model and contract"]
        core["Core"]
        graph["Graph references"]
        digest["Canonical digest"]
    end
    subgraph node-api["Node API"]
        cli["CLI"]
        evidence["Evidence verification"]
    end
    subgraph render["Map rendering"]
        map["Architecture map"]
        inspector["Inspector and overview"]
    end
    map -->|"load"| core
    core -->|"validate"| graph
    core -->|"digest"| digest
    map -->|"inspect"| inspector
    cli -->|"apply"| core
    cli -->|"verify"| evidence
```

<a id="record-archivarius"></a>

## Archivarius

Scope

**Purpose:**

A single validated JSON snapshot describes a project's architecture, requirements, decisions, scenarios, tasks and checks, and a React library renders it as an architecture map with semantic zoom\.

<a id="record-owner-intent"></a>

## Purpose of the library

Source

**Scope:**

- [Archivarius](#record-archivarius)

**Origin:**

owner

**Statement:**

An owner understands a system's structure, the grounds for decisions, the remaining work and the effect of changes from one snapshot; an LLM reads and edits the same records\.

<a id="record-contract-basis"></a>

## Provenance and freshness model

Source

**Scope:**

- [Archivarius](#record-archivarius)

**Origin:**

assumption

**Statement:**

Revisions, used context and check results are distinct from ordinary references so that stale grounds and superseded evidence cannot pass as current confirmation\.

<a id="record-model"></a>

## Model and contract

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Kind:**

subsystem

**Layer:**

pure

**Responsibility:**

Owns the v4 JSON schema, record types, graph references, history, snapshots and the validated\-change contract\.

<a id="record-core"></a>

## Core

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Model and contract](#record-model)

**Kind:**

component

**Layer:**

pure

**Responsibility:**

Parses and validates a model, projects a v4 project to an architecture, and analyzes freshness and completion\.

**Detail boundary:**

Layout and rendering stay outside the core\.

<a id="record-graph"></a>

## Graph references

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Model and contract](#record-model)

**Kind:**

component

**Layer:**

pure

**Responsibility:**

Validates typed relations between records and reports reverse links and coverage\.

**Detail boundary:**

Reference semantics are fixed by the schema targets\.

<a id="record-digest"></a>

## Canonical digest

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Model and contract](#record-model)

**Kind:**

component

**Layer:**

pure

**Responsibility:**

Computes the SHA\-256 basis over a canonical representation of the definitions\.

**Detail boundary:**

The canonicalization rules are internal to the digest\.

<a id="record-node-api"></a>

## Node API

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Kind:**

subsystem

**Layer:**

infrastructure

**Responsibility:**

Reads a model file, verifies evidence artifacts by bytes, applies validated changes, and generates documentation\.

<a id="record-cli"></a>

## CLI

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Node API](#record-node-api)

**Kind:**

component

**Layer:**

infrastructure

**Responsibility:**

Exposes validate, read, context, apply, documents, verify, run and archive over the model file\.

**Detail boundary:**

Argument parsing and file paths stay inside the CLI\.

<a id="record-evidence"></a>

## Evidence verification

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Node API](#record-node-api)

**Kind:**

component

**Layer:**

infrastructure

**Responsibility:**

Matches declared binding bytes against files and records actual check outcomes\.

**Detail boundary:**

Executing checks is performed by the run command, not by loading a model\.

<a id="record-render"></a>

## Map rendering

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Kind:**

subsystem

**Layer:**

presentation

**Responsibility:**

Mounts an interactive architecture map with semantic zoom and an inspector for records\.

<a id="record-map"></a>

## Architecture map

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Map rendering](#record-render)

**Kind:**

component

**Layer:**

presentation

**Responsibility:**

Lays out components and interactions and reveals detail as the map is zoomed\.

**Detail boundary:**

Layout geometry stays inside the map\.

<a id="record-inspector"></a>

## Inspector and overview

Component

**Scope:**

- [Archivarius](#record-archivarius)

**Part of:**

- [Map rendering](#record-render)

**Kind:**

component

**Layer:**

presentation

**Responsibility:**

Shows a record's meaning, links, implementation outcome and the reasons requiring attention\.

**Detail boundary:**

Project data and UI copy stay external resources\.

<a id="record-model-source"></a>

## Model source

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

A v4 JSON snapshot as a URL, File, Blob or parsed object\.

**Meaning:**

The rendering subsystem loads a snapshot to display\.

**Constraints:**

- [One snapshot, one set of definitions](#record-single-snapshot)

<a id="record-change-input"></a>

## Change input

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

A context receipt and a change with put and remove sets\.

**Meaning:**

The node API applies a validated change against an unchanged context\.

**Constraints:**

- [Changes are validated against an unchanged context](#record-validated-change)

<a id="record-evidence-artifact"></a>

## Evidence artifact

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

Relative binding paths and the bytes they resolve to\.

**Meaning:**

Evidence verification compares declared inputs against actual files\.

**Constraints:**

- [Confirmation needs byte\-exact evidence](#record-byte-exact-evidence)

<a id="record-reference-set"></a>

## Reference set

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

The typed relations between records\.

**Meaning:**

The core asks the graph to validate references and report coverage\.

**Constraints:**

- [One snapshot, one set of definitions](#record-single-snapshot)

<a id="record-basis-value"></a>

## Basis value

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

The canonical definitions and their SHA\-256 basis\.

**Meaning:**

The core asks the digest for the freshness basis\.

**Constraints:**

- [One snapshot, one set of definitions](#record-single-snapshot)

<a id="record-record-detail"></a>

## Record detail

Interaction contract

**Scope:**

- [Archivarius](#record-archivarius)

**Payload:**

A selected record with its links and implementation outcome\.

**Meaning:**

The map opens a record in the inspector\.

**Constraints:**

- [One snapshot, one set of definitions](#record-single-snapshot)

<a id="record-load-model"></a>

## Load a snapshot

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [Architecture map](#record-map)

**To:**

- [Core](#record-core)

**Kind:**

data

**Channel:**

load

**Contract:**

- [Model source](#record-model-source)

<a id="record-check-references"></a>

## Validate references

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [Core](#record-core)

**To:**

- [Graph references](#record-graph)

**Kind:**

command

**Channel:**

validate

**Contract:**

- [Reference set](#record-reference-set)

<a id="record-compute-basis"></a>

## Compute the basis

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [Core](#record-core)

**To:**

- [Canonical digest](#record-digest)

**Kind:**

command

**Channel:**

digest

**Contract:**

- [Basis value](#record-basis-value)

<a id="record-inspect-record"></a>

## Open a record

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [Architecture map](#record-map)

**To:**

- [Inspector and overview](#record-inspector)

**Kind:**

state

**Channel:**

inspect

**Contract:**

- [Record detail](#record-record-detail)

<a id="record-apply-change"></a>

## Apply a change

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [CLI](#record-cli)

**To:**

- [Core](#record-core)

**Kind:**

command

**Channel:**

apply

**Contract:**

- [Change input](#record-change-input)

<a id="record-verify-evidence"></a>

## Verify evidence

Interaction

**Scope:**

- [Archivarius](#record-archivarius)

**From:**

- [CLI](#record-cli)

**To:**

- [Evidence verification](#record-evidence)

**Kind:**

data

**Channel:**

verify

**Contract:**

- [Evidence artifact](#record-evidence-artifact)

<a id="record-single-snapshot"></a>

## One snapshot, one set of definitions

Requirement

**Scope:**

- [Archivarius](#record-archivarius)

**Rule:**

Every statement has a single definition; all views render the one selected snapshot\.

**Conditions:**

- A model is loaded or rendered\.

**Applies to:**

- [Core](#record-core)
- [Map rendering](#record-render)

**Based on:**

- [Purpose of the library](#record-owner-intent)

<a id="record-single-snapshot-c"></a>

## Views agree with the snapshot

Criterion

**Scope:**

- [Archivarius](#record-archivarius)

**Requirement:**

- [One snapshot, one set of definitions](#record-single-snapshot)

**Criterion:**

The map, inspector and generated documentation all reflect the same loaded snapshot and definitions\.

<a id="record-validated-change"></a>

## Changes are validated against an unchanged context

Requirement

**Scope:**

- [Archivarius](#record-archivarius)

**Rule:**

A change requires an unchanged context receipt; a stale context, unknown field or broken reference is rejected and the source file is preserved\.

**Conditions:**

- A change is applied through the API or CLI\.

**Applies to:**

- [Node API](#record-node-api)
- [Core](#record-core)

**Based on:**

- [Provenance and freshness model](#record-contract-basis)

<a id="record-validated-change-c"></a>

## Stale or invalid changes are refused

Criterion

**Scope:**

- [Archivarius](#record-archivarius)

**Requirement:**

- [Changes are validated against an unchanged context](#record-validated-change)

**Criterion:**

A stale context, unknown field or broken reference is rejected and the input model is left unmodified\.

<a id="record-byte-exact-evidence"></a>

## Confirmation needs byte\-exact evidence

Requirement

**Scope:**

- [Archivarius](#record-archivarius)

**Rule:**

A check outcome confirms only with an available execution artifact and matching bytes for every declared input; missing or stale evidence does not confirm\.

**Conditions:**

- An implementation outcome is derived\.

**Applies to:**

- [Evidence verification](#record-evidence)

**Based on:**

- [Provenance and freshness model](#record-contract-basis)

<a id="record-byte-exact-evidence-c"></a>

## Stale and missing evidence cannot confirm

Criterion

**Scope:**

- [Archivarius](#record-archivarius)

**Requirement:**

- [Confirmation needs byte\-exact evidence](#record-byte-exact-evidence)

**Criterion:**

A result confirms only when its artifact exists and every declared input's bytes match; otherwise the criterion is not confirmed\.

<a id="record-conservative-freshness"></a>

## Conservative freshness

Requirement

**Scope:**

- [Archivarius](#record-archivarius)

**Rule:**

Changing any definition conservatively marks dependent decisions, tasks and checks as requiring review; the current review scope is the whole project\.

**Conditions:**

- A definition changes\.

**Applies to:**

- [Core](#record-core)

**Based on:**

- [Provenance and freshness model](#record-contract-basis)

<a id="record-conservative-freshness-c"></a>

## Dependents are marked for review

Criterion

**Scope:**

- [Archivarius](#record-archivarius)

**Requirement:**

- [Conservative freshness](#record-conservative-freshness)

**Criterion:**

After a definition changes, decisions, tasks and checks depending on it report their basis as no longer current\.

<a id="record-basis-digest"></a>

## Canonical digest for the basis

Decision

**Scope:**

- [Archivarius](#record-archivarius)

**Decision topic:**

freshness\-basis

**Choice:**

Compute basis\.contract as a SHA\-256 over a canonical representation of the definitions, excluding results, history and review text\.

**Alternatives:**

- Track freshness by timestamps or manual review flags\.

**Rationale:**

A content digest detects real definition changes without trusting order or edit metadata\.

**Consequences:**

- Any definition change, including additions, drops the current basis\.

**Affects:**

- [Canonical digest](#record-digest)

**Uses:**

- [Conservative freshness](#record-conservative-freshness)
- [Changes are validated against an unchanged context](#record-validated-change)

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Canonical digest for the basis](#record-basis-digest)

<a id="record-external-resources"></a>

## Project data and copy stay external

Decision

**Scope:**

- [Archivarius](#record-archivarius)

**Decision topic:**

resource\-loading

**Choice:**

Load model data and UI copy as external resources rather than bundling them into the library\.

**Alternatives:**

- Embed a default model and copy in the shipped scripts\.

**Rationale:**

The format stays independent of any project, repository or build, and shipped scripts do not carry project data\.

**Consequences:**

- A consumer supplies the model source and container\.

**Affects:**

- [Map rendering](#record-render)

**Uses:**

- [One snapshot, one set of definitions](#record-single-snapshot)

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Project data and copy stay external](#record-external-resources)

<a id="record-edit-and-render"></a>

## Edit a definition and re\-render

Scenario

**Scope:**

- [Archivarius](#record-archivarius)

**Actor:**

LLM agent

**Preconditions:**

- A validated snapshot is loaded\.

**Actions:**

- Read a focused record's context\.
- Apply a validated change against the unchanged context\.
- Re\-validate the whole snapshot\.
- Re\-render the map and inspector\.

**Uses:**

- [Changes are validated against an unchanged context](#record-validated-change)
- [Conservative freshness](#record-conservative-freshness)

**Expected outcomes:**

- [Stale or invalid changes are refused](#record-validated-change-c)
- [Dependents are marked for review](#record-conservative-freshness-c)

**Failure and recovery:**

- A stale context is rejected and the model is preserved\.
- A broken reference fails validation\.

<a id="record-task-model"></a>

## Maintain the model and contract

Task

**Scope:**

- [Archivarius](#record-archivarius)

**Change:**

Keep the schema, graph references, digest and validated\-change path consistent\.

**Affects:**

- [Core](#record-core)
- [Graph references](#record-graph)
- [Canonical digest](#record-digest)

**Covers:**

- [Stale or invalid changes are refused](#record-validated-change-c)
- [Dependents are marked for review](#record-conservative-freshness-c)

**Uses:**

- [Canonical digest for the basis](#record-basis-digest)
- [Edit a definition and re\-render](#record-edit-and-render)

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Maintain the model and contract](#record-task-model)

<a id="record-task-render"></a>

## Render the snapshot

Task

**Scope:**

- [Archivarius](#record-archivarius)

**Change:**

Mount the map and inspector from one loaded snapshot\.

**Affects:**

- [Architecture map](#record-map)
- [Inspector and overview](#record-inspector)

**Covers:**

- [Views agree with the snapshot](#record-single-snapshot-c)

**Uses:**

- [Project data and copy stay external](#record-external-resources)

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Render the snapshot](#record-task-render)

<a id="record-task-evidence"></a>

## Verify evidence and outcomes

Task

**Scope:**

- [Archivarius](#record-archivarius)

**Change:**

Match declared binding bytes and record actual check outcomes\.

**Affects:**

- [Evidence verification](#record-evidence)
- [CLI](#record-cli)

**Covers:**

- [Stale and missing evidence cannot confirm](#record-byte-exact-evidence-c)

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Verify evidence and outcomes](#record-task-evidence)

<a id="record-check-model"></a>

## Model and change validation

Check

**Scope:**

- [Archivarius](#record-archivarius)

**Check method:**

Validate models and reject stale contexts, unknown fields, broken references and forged bases\.

**Covers:**

- [Stale or invalid changes are refused](#record-validated-change-c)
- [Dependents are marked for review](#record-conservative-freshness-c)

**Scenarios:**

- [Edit a definition and re\-render](#record-edit-and-render)

**Verifies:**

- [Core](#record-core)
- [Graph references](#record-graph)
- [Canonical digest](#record-digest)

**Check level:**

integration

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Model and change validation](#record-check-model)

<a id="record-check-render"></a>

## Rendering from one snapshot

Check

**Scope:**

- [Archivarius](#record-archivarius)

**Check method:**

Render the map, inspector and documentation from a single snapshot and confirm they agree\.

**Covers:**

- [Views agree with the snapshot](#record-single-snapshot-c)

**Scenarios:**

- [Edit a definition and re\-render](#record-edit-and-render)

**Verifies:**

- [Map rendering](#record-render)
- [Architecture map](#record-map)
- [Inspector and overview](#record-inspector)

**Check level:**

integration

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Rendering from one snapshot](#record-check-render)

<a id="record-check-evidence"></a>

## Byte\-exact evidence

Check

**Scope:**

- [Archivarius](#record-archivarius)

**Check method:**

Confirm outcomes only with an available artifact and matching declared\-input bytes\.

**Covers:**

- [Stale and missing evidence cannot confirm](#record-byte-exact-evidence-c)

**Scenarios:**

- [Edit a definition and re\-render](#record-edit-and-render)

**Verifies:**

- [Evidence verification](#record-evidence)

**Check level:**

integration

**Contract basis:**

null

**Why confirmation is missing:**

- Basis has not been recorded: [Byte\-exact evidence](#record-check-evidence)
