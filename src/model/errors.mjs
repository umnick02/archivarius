/**
 * What a validator reports about one failure: a stable `code` and the JSON
 * Pointer `path` that failed, plus whichever detail the producer has — the
 * record a rule names, or the schema keyword that rejected the value.
 *
 * @typedef {{ code: string, path: string, subject?: string, keyword?: string,
 *   schemaPath?: string, params?: Record<string, string | undefined> }} Diagnostic
 */

export class ArchitectureError extends Error {
  constructor(code, issues = [], diagnostics = []) {
    super([code, ...issues].join('\n'));
    this.name = 'ArchitectureError';
    this.code = code;
    this.issues = issues;
    this.diagnostics = diagnostics;
  }
}

/**
 * One code a failure carries, in the words a caller who caught it needs: what
 * went wrong, and the one thing that resolves it.
 *
 * @typedef {{ meaning: string, remedy: string }} Failure
 */

/** @type {Record<string, Failure>} */
export const failureCodes = {
  ARCHIVE_CYCLE: {
    meaning: 'The history archive links back to a segment already read.',
    remedy: 'Restore the archive directory from a backup or drop the history.',
  },
  ARCHIVE_DIGEST: {
    meaning: 'An archive segment does not hash to the name it is stored under.',
    remedy: 'Replace the segment file with the bytes that produced its hash.',
  },
  ARCHIVE_PATH: {
    meaning:
      'The history directory beside the model is a link or is not where the model names it.',
    remedy:
      'Make the history a real directory next to the model file and retry.',
  },
  ARCHIVE_REFERENCE: {
    meaning: 'An archive reference is not a 64-character hexadecimal digest.',
    remedy: 'Fix the archive head or previous reference in the model file.',
  },
  ARCHIVE_STRUCTURE: {
    meaning:
      'A model with an external archive carries inline history, or a segment has the wrong fields.',
    remedy:
      'Keep history in the archive segments only and give each segment version, previous, history and snapshots.',
  },
  ARTIFACT_CHANGED: {
    meaning: 'A bound artifact no longer hashes to the digest recorded for it.',
    remedy:
      'Rerun the check to record fresh evidence, or restore the artifact bytes.',
  },
  ARTIFACT_PATH: {
    meaning:
      'An artifact path escapes the project directory or is not relative to it.',
    remedy:
      'Give a relative path that stays inside the project directory, with no link out of it.',
  },
  BASIS_CHANGED: {
    meaning:
      'A result was recorded against a different contract or realization than the current one.',
    remedy: 'Rerun the check against the current model to record a new result.',
  },
  BINDINGS_REQUIRED: {
    meaning: 'The model binds no file, so a run has no realization to hash.',
    remedy: 'Bind the files the check covers before running it.',
  },
  CHECK_NOT_CURRENT: {
    meaning:
      'The named check does not exist or its basis is stale, so its outcome could not be trusted.',
    remedy:
      'Reconsider the check and the records it depends on, then run it again.',
  },
  COMMAND_REQUIRED: {
    meaning: 'The check to run states no command as a list of strings.',
    remedy: 'Give the check a command array before running it.',
  },
  CONNECTOR_MISSING: {
    meaning:
      'A relation ends outside its routed group and no connector reaches its endpoint.',
    remedy:
      'Report it with the model: the layout produced a route the view cannot draw.',
  },
  CONNECTOR_ROUTE_MISSING: {
    meaning:
      'No orthogonal path exists between a connector endpoint and its group boundary.',
    remedy:
      'Report it with the model: the layout produced geometry with no route through it.',
  },
  CONTAINER_IN_USE: {
    meaning: 'The given element already hosts a mounted map.',
    remedy: 'Destroy the existing handle or mount into another element.',
  },
  CONTAINER_NOT_EMPTY: {
    meaning: 'The given element already has child nodes.',
    remedy: 'Mount into an empty element the map may own.',
  },
  CONTAINER_REQUIRED: {
    meaning: 'The first argument to the mount call is not a DOM element.',
    remedy: 'Pass an element node to mount into.',
  },
  CONTEXT_CHANGED: {
    meaning:
      'The model moved since the receipt was taken, so the change was not based on what was read.',
    remedy: 'Read a fresh context for the same keys and reapply the change.',
  },
  CONTEXT_INCOMPLETE: {
    meaning:
      'A record being changed or removed depends on records the receipt never showed.',
    remedy:
      'Read a context that covers the whole dependency closure of those keys.',
  },
  DOCUMENTS_MISSING: {
    meaning: 'The model declares no document to write.',
    remedy: 'Add a document record before writing documents.',
  },
  DOCUMENTS_OUT_OF_DATE: {
    meaning: 'A document file on disk differs from what the model renders.',
    remedy: 'Run the documents command without check to rewrite the files.',
  },
  DOCUMENT_BLOCK: {
    meaning: 'A document block names a kind the renderer does not know.',
    remedy: 'Use a block kind the shipped contract allows.',
  },
  DOCUMENT_DESTINATION: {
    meaning:
      'A document path leaves the output directory or targets the model file itself.',
    remedy: 'Give the document a relative path inside the output directory.',
  },
  DOCUMENT_OUT_OF_DATE: {
    meaning:
      'The generated file checked against the model no longer matches what the model renders.',
    remedy: 'Regenerate the file instead of editing it by hand.',
  },
  DOCUMENT_SYMLINK: {
    meaning: 'A segment of a document path is a symbolic link.',
    remedy: 'Replace the link with a real directory or file and retry.',
  },
  DUPLICATE_RECORD: {
    meaning: 'One change puts the same record key more than once.',
    remedy: 'Send one revision per key in a change.',
  },
  ELK_ROUTE_MISSING: {
    meaning: 'The layout holds no route for a relation the view has to draw.',
    remedy:
      'Report it with the model: the layout and the projection disagree about the relations.',
  },
  EVIDENCE_INVALID: {
    meaning:
      'A check receipt does not describe the result it is offered for, or its fields are malformed.',
    remedy:
      'Rerun the check so the receipt records the command, exit code and times of that result.',
  },
  EVIDENCE_UNAVAILABLE: {
    meaning: 'A receipt or artifact the browser needs could not be fetched.',
    remedy: 'Serve the evidence files alongside the model and reload.',
  },
  IDENTITY_TYPE: {
    meaning: 'A change reuses an existing record key with a different type.',
    remedy: 'Remove the old record and add the new one under its own key.',
  },
  INVALID_ARGUMENTS: {
    meaning: 'The command line combination is not one the CLI accepts.',
    remedy: 'Check the required flags for that command and run it again.',
  },
  INVALID_CHANGE: {
    meaning:
      'The change itself does not match the change contract; the diagnostics say where.',
    remedy: 'Fix the change to the shape the diagnostics point at.',
  },
  INVALID_JSON: {
    meaning: 'The input is not a string, or it is not parsable JSON.',
    remedy: 'Pass the model text and correct the syntax the diagnostics name.',
  },
  INVALID_LAYOUT: {
    meaning: 'The computed geometry failed its own consistency checks.',
    remedy:
      'Report it with the model: the issues list names the failing invariant.',
  },
  INVALID_MODEL: {
    meaning:
      'The model breaks the contract or a graph rule; the diagnostics say where.',
    remedy: 'Fix the model at the paths the diagnostics name.',
  },
  LOAD_SUPERSEDED: {
    meaning: 'A newer load on the same handle replaced this one.',
    remedy: 'Await only the latest load and ignore this abort.',
  },
  MAP_DESTROYED: {
    meaning: 'The handle was destroyed before the call could be served.',
    remedy: 'Mount a new map instead of reusing a destroyed handle.',
  },
  MAP_NOT_READY: {
    meaning: 'The handle has no loaded model yet.',
    remedy: 'Await the load promise before calling the handle.',
  },
  MODEL_BUSY: {
    meaning: 'Another writer holds the lock file beside the model.',
    remedy:
      'Wait for that writer, or remove the stale lock file if no writer is left.',
  },
  MODEL_LOAD_FAILED: {
    meaning: 'The model source could not be fetched or returned a bad status.',
    remedy: 'Check the model URL and that it is served to the page.',
  },
  OUTPUT_IS_MODEL: {
    meaning: 'The requested output file is the model file being read.',
    remedy: 'Write the output to a different path.',
  },
  REALIZATION_CHANGED: {
    meaning: 'A bound file changed while the check was being verified or run.',
    remedy: 'Rebind the changed files and run the check again.',
  },
  REALIZATION_UNAVAILABLE: {
    meaning:
      'No bound file could be read, so nothing anchors the results to code.',
    remedy: 'Make the bound files readable from the project directory.',
  },
  RESOURCES_LOAD_FAILED: {
    meaning: 'A shipped asset the map needs could not be fetched.',
    remedy:
      'Serve the package assets, or point the map at them with the assets base URL.',
  },
  RESULT_IMMUTABLE: {
    meaning: 'A change rewrites a result record that already exists.',
    remedy: 'Record a new result under a new key instead of editing this one.',
  },
  REVIEW_REQUIRED: {
    meaning:
      'A basis was set or reconsidered without a reason and a receipt that covers everything it rests on.',
    remedy:
      'Read a context over the whole closure and pass the review keys with a reason.',
  },
  UNKNOWN_NODE: {
    meaning: 'The key given to the map names no drawn node.',
    remedy: 'Pass the key of a component the current model draws.',
  },
  UNKNOWN_RECORD: {
    meaning: 'The key given names no record in the model.',
    remedy: 'Pass a key the model defines.',
  },
};

export const failureCatalogue = {
  title: 'Failure codes',
  note: 'Every failure raised by the library carries one of these codes on its code property.',
  columns: ['Code', 'Meaning', 'What to do'],
};
