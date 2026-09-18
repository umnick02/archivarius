import prose from '../generated/prose.mjs';
import referenceFields from '../generated/references.mjs';

/**
 * What a validator reports about one failure: a stable `code` and the JSON
 * Pointer `path` that failed, plus whichever detail the producer has — the
 * record a rule names, or the schema keyword that rejected the value.
 *
 * `record`, `field`, `value` and `expected` are what `explainDiagnostics` adds
 * so a reader never has to decode the contract: the record key the failure sits
 * in, the field inside it, a short safe summary of the value that was read
 * (`'absent'` when there is none) and the accepted shape in words.
 *
 * @typedef {{ code: string, path: string, subject?: string, keyword?: string,
 *   schemaPath?: string, params?: Record<string, string | undefined>,
 *   record?: string, field?: string, value?: string,
 *   expected?: string }} Diagnostic
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

// A rejection is a message to a person, so it names the record, the field and
// the value it read, and states the accepted shape beside them. One path does it
// for every validator: the diagnostics carry a JSON Pointer, so the value and
// the record it sits in are read back out of the input the validator was given.

const maxCharacters = 80;
const maxNames = 8;

const pointerSegment = (value) =>
  String(value).replaceAll('~', '~0').replaceAll('/', '~1');

const pointerTokens = (path) =>
  !path || path === '/'
    ? []
    : String(path)
        .replace(/^\//, '')
        .split('/')
        .map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'));

// Model content is never trusted output: control characters are neutralized and
// the text is cut, so no diagnostic can carry a document or drive a renderer.
const plain = (text, limit = maxCharacters) => {
  const safe = String(text).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ');
  return safe.length > limit ? safe.slice(0, limit) + '\u2026' : safe;
};

const quoted = (text) =>
  '"' +
  plain(text) +
  '"' +
  (String(text).length > maxCharacters
    ? ' (' + String(text).length + ' characters)'
    : '');

const nameList = (names) => {
  const shown = names.slice(0, maxNames).map((name) => plain(name, 40));
  const rest = names.length - shown.length;
  const joined = shown.length
    ? shown.length > 1
      ? shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1]
      : shown[0]
    : 'nothing';
  return rest ? joined + ' and ' + rest + ' more' : joined;
};

const literal = (value) =>
  typeof value === 'string' ? quoted(value) : String(value);

/** @param {unknown} value @returns {string} */
function readValue(value) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (typeof value === 'string') return 'the string ' + quoted(value);
  if (typeof value === 'number' || typeof value === 'boolean')
    return 'the ' + typeof value + ' ' + String(value);
  if (Array.isArray(value))
    return (
      'an array of ' +
      value.length +
      (value.length === 1 ? ' entry' : ' entries')
    );
  if (typeof value === 'object')
    return 'an object with the fields ' + nameList(Object.keys(value));
  return 'a ' + typeof value;
}

/** @param {unknown} value @returns {string} */
const typeName = (value) =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'a list of ' +
        (value.length ? typeName(value[0]).replace(/^an? /, '') + 's' : 'items')
      : typeof value === 'object'
        ? 'an object'
        : 'a ' + typeof value;

const isRecord = (value) =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof value.key === 'string' &&
  typeof value.type === 'string';

// Both inputs a validator is handed carry records: a model under `records`, a
// change under `put`.
function* everyRecord(root) {
  for (const list of [root?.records, root?.put])
    if (Array.isArray(list))
      for (const item of list) if (isRecord(item)) yield item;
}

// Follow the pointer through the input, remembering the innermost record on the
// way, so a failure deep inside a block still names the record it belongs to.
function locate(root, path) {
  const tokens = pointerTokens(path);
  const chain = [root];
  let inside = root;
  let stopped = tokens.length;
  for (const [i, token] of tokens.entries()) {
    if (!inside || typeof inside !== 'object') {
      stopped = i;
      break;
    }
    inside = Object.hasOwn(inside, token) ? inside[token] : undefined;
    chain.push(inside);
    if (inside === undefined) {
      stopped = i + 1;
      break;
    }
  }
  let record,
    at = 0;
  for (const [i, entry] of chain.entries())
    if (isRecord(entry)) {
      record = entry;
      at = i;
    }
  const reached = stopped === tokens.length;
  const relative = record ? tokens.slice(at) : tokens.slice(-1);
  return {
    record,
    field: relative.length ? relative.join('/') : undefined,
    value: reached ? chain[chain.length - 1] : undefined,
    reached,
  };
}

const branchOf = (schemaPath) =>
  (String(schemaPath ?? '').match(/^#\/(?:oneOf|anyOf)\/\d+/) || [''])[0];

// A record union reports every branch it tried. The branch that describes the
// record's own type is the one whose `type` constant still held, so the constants
// the other branches raised name them and the missing entry names this record.
const branchTypes = (diagnostics) => {
  const found = new Map();
  for (const item of diagnostics)
    if (
      item.keyword === 'const' &&
      /\/properties\/type\/const$/.test(String(item.schemaPath ?? ''))
    )
      found.set(branchOf(item.schemaPath), item.params?.allowedValue);
  return found;
};

// What the contract says a field holds, in the order the answer is trustworthy:
// what its siblings really hold, then the prose and reference tables generated
// from the schema.
function fieldShape(root, type, field) {
  for (const other of everyRecord(root))
    if (other.type === type && other[field] !== undefined)
      return typeName(other[field]);
  const written = (prose[type] ?? []).find((entry) => entry.name === field);
  if (written) return written.many ? 'a list of strings' : 'a string';
  const reference = (referenceFields[type] ?? []).find(
    (entry) => entry.name === field,
  );
  return reference
    ? 'a record key of type ' + nameList(reference.types)
    : undefined;
}

const declaredFields = (root, type, record, unknown) => {
  const others = [...everyRecord(root)].filter(
    (other) => other.type === type && other !== record,
  );
  const names = new Set(others.flatMap((other) => Object.keys(other)));
  if (!names.size)
    for (const name of Object.keys(record ?? {}))
      if (name !== unknown) names.add(name);
  return [...names];
};

const referenceTargets = (type, field) => {
  const reference = (referenceFields[type] ?? []).find(
    (entry) => entry.name === field,
  );
  return reference
    ? 'The key of an existing record of type ' + nameList(reference.types) + '.'
    : 'The key of an existing record.';
};

function acceptedShape(diagnostic, found) {
  const { code, keyword, params = {} } = diagnostic;
  const { root, record, field, value, branch } = found;
  const own = record?.type;
  const type = branch ?? own;
  if (code === 'MISSING_REFERENCE' || code === 'REFERENCE_TYPE')
    return referenceTargets(own, field);
  if (code === 'SELF_REFERENCE')
    return 'The key of another record, not this one.';
  switch (keyword) {
    case 'required': {
      const name = params.missingProperty;
      if (!type) return 'The field "' + name + '" is required.';
      if (branch && own && branch !== own)
        return (
          'Only a "' +
          branch +
          '" record requires the field "' +
          name +
          '"; this record declares type "' +
          own +
          '".'
        );
      const shape = fieldShape(root, type, name);
      return (
        'A "' +
        type +
        '" record requires the field "' +
        name +
        '"' +
        (shape ? ' (' + shape + ')' : '') +
        '.'
      );
    }
    case 'enum': {
      const allowed = nameList((params.allowedValues ?? []).map(literal));
      return type
        ? 'A "' +
            type +
            '" record allows "' +
            field +
            '" to be ' +
            allowed +
            '.'
        : 'One of ' + allowed + '.';
    }
    case 'const':
      return 'Exactly ' + literal(params.allowedValue) + '.';
    case 'type':
      return (
        'A ' +
        [].concat(params.type).join(' or ') +
        ', not ' +
        typeName(value) +
        '.'
      );
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const unknown =
        params.additionalProperty ?? params.unevaluatedProperty ?? field;
      return type
        ? 'A field a "' +
            type +
            '" record declares: ' +
            nameList(declaredFields(root, type, record, unknown)) +
            '.'
        : 'A field the contract accepts at this path, which "' +
            plain(unknown, 40) +
            '" is not.';
    }
    case 'minItems':
      return 'At least ' + params.limit + ' entries.';
    case 'maxItems':
      return 'At most ' + params.limit + ' entries.';
    case 'minLength':
      return 'At least ' + params.limit + ' characters.';
    case 'maxLength':
      return 'At most ' + params.limit + ' characters.';
    case 'pattern':
      return 'Text matching ' + quoted(params.pattern) + '.';
    case 'format':
      return 'A value in the ' + params.format + ' format.';
    case 'uniqueItems':
      return 'Entries that all differ.';
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
      return 'A number ' + params.comparison + ' ' + params.limit + '.';
    default:
      return undefined;
  }
}

/**
 * Point every diagnostic at what it read: the record key, the field, a summary
 * of the value and the accepted shape. Fields a producer already stated are
 * kept, and a pointer that does not resolve in `root` only loses the value.
 *
 * @param {Diagnostic[]} diagnostics
 * @param {unknown} root the input the validator was given
 * @returns {Diagnostic[]}
 */
export function explainDiagnostics(diagnostics, root) {
  if (!diagnostics.length) return diagnostics;
  const branches = branchTypes(diagnostics);
  return diagnostics.map((diagnostic) => {
    const found = locate(root, diagnostic.path);
    // A rule that names one broken entry read that entry, not the list holding it.
    const value =
      Array.isArray(found.value) &&
      diagnostic.subject !== undefined &&
      found.value.includes(diagnostic.subject)
        ? diagnostic.subject
        : found.value;
    const field = diagnostic.field ?? found.field;
    const key = diagnostic.record ?? found.record?.key;
    const expected =
      diagnostic.expected ??
      acceptedShape(diagnostic, {
        root,
        record: found.record,
        field,
        value,
        branch: branches.get(branchOf(diagnostic.schemaPath)),
      });
    return {
      ...diagnostic,
      ...(key === undefined ? {} : { record: key }),
      ...(field === undefined ? {} : { field }),
      ...(found.reached ? { value: readValue(value) } : {}),
      ...(expected === undefined ? {} : { expected }),
    };
  });
}

/**
 * Say what moved under a receipt: which read, document or manifest digest the
 * author was shown and what the model reads now.
 *
 * @typedef {{ keys?: unknown, snapshot?: string, records?: unknown[],
 *   reads?: Record<string, string>,
 *   documents?: Array<{ key?: string, digest?: string }> }} Receipt
 * @param {Receipt | null | undefined} context the receipt a change was based on
 * @param {Receipt | null | undefined} current the same read taken from the model
 *   as it stands
 * @returns {Diagnostic[]}
 */
export function staleContextDiagnostics(context, current) {
  const code = 'CONTEXT_CHANGED';
  if (!context || typeof context !== 'object' || !Array.isArray(context.keys))
    return explainDiagnostics(
      [
        {
          code,
          path: '/keys',
          field: 'keys',
          expected:
            'A receipt whose keys field lists the record keys it was read for.',
        },
      ],
      context ?? {},
    );
  /** @type {Diagnostic[]} */
  const raw = [];
  const was =
    context.reads && typeof context.reads === 'object' ? context.reads : {};
  const now = current?.reads ?? {};
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)]))
    if (was[key] !== now[key])
      raw.push({
        code,
        subject: key,
        path: '/reads/' + pointerSegment(key),
        record: key,
        field: 'reads',
        expected: now[key]
          ? 'The digest "' + now[key] + '" the model now reads for that record.'
          : 'No read at all, because the model no longer defines that record.',
      });
  const documents = Array.isArray(context.documents) ? context.documents : [];
  const rendered = new Map(
    (current?.documents ?? []).map((entry) => [entry.key, entry.digest]),
  );
  for (const [i, entry] of documents.entries())
    if (entry?.digest !== rendered.get(entry?.key))
      raw.push({
        code,
        subject: entry?.key,
        path: '/documents/' + i + '/digest',
        record: entry?.key,
        field: 'documents',
        expected: rendered.has(entry?.key)
          ? 'The digest "' +
            rendered.get(entry?.key) +
            '" that document renders to now.'
          : 'No section at all, because that document no longer covers the read.',
      });
  if (current && context.snapshot !== current.snapshot)
    raw.push({
      code,
      path: '/snapshot',
      field: 'snapshot',
      expected:
        'The digest "' + current.snapshot + '" of the manifest as it stands.',
    });
  if (!raw.length)
    raw.push({
      code,
      path: '/records',
      field: 'records',
      expected: current
        ? 'The ' +
          current.records.length +
          ' records the model now reads for those keys.'
        : 'A receipt read from the model as it stands.',
    });
  return explainDiagnostics(raw, context);
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
    meaning: 'The history archive links back to a source already read.',
    remedy: 'Restore the referenced Git history or archive segments.',
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
      'An archive descriptor or segment has the wrong fields, or a segment-backed model carries inline history.',
    remedy:
      'Use the versioned archive descriptor; only Git-backed models may retain pending inline history.',
  },
  GIT_HISTORY_REFERENCE: {
    meaning:
      'A Git history reference has an invalid commit or repository-relative path.',
    remedy:
      'Use a full commit hash and a normalized path within the repository.',
  },
  GIT_HISTORY_UNAVAILABLE: {
    meaning:
      'Git could not read the repository, referenced commit or model history.',
    remedy:
      'Install Git and restore the referenced commits and files, including history omitted by a shallow clone.',
  },
  GIT_HISTORY_UNCOMMITTED: {
    meaning:
      'The model or its archive differs from the version retained in HEAD.',
    remedy:
      'Commit the complete model and archive before migrating their history to Git.',
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
  CONTRACT_TOO_NEW: {
    meaning:
      'The model states a contract version newer than this library reads.',
    remedy: 'Upgrade the library to one that reads that contract version.',
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
  MODEL_TOO_DEEP: {
    meaning:
      'The model nests components deeper than the stated maximum depth, which the diagnostics name with the depth read.',
    remedy: 'Flatten the containment so it stays inside the stated depth.',
  },
  MODEL_TOO_LARGE: {
    meaning:
      'The model text is larger than the stated maximum in bytes, which the diagnostics name with the size read.',
    remedy:
      'Split the model, or serve a smaller one that stays inside the byte bound.',
  },
  MODEL_TOO_MANY_RECORDS: {
    meaning:
      'The model declares more records than the stated maximum, which the diagnostics name with the count read.',
    remedy: 'Split the model into maps that each stay inside the record bound.',
  },
  MODEL_TOO_MANY_RELATIONS: {
    meaning:
      'The model declares more relations than the stated maximum, which the diagnostics name with the count read.',
    remedy:
      'Bundle or split the relations so a map stays inside the relation bound.',
  },
  OUTPUT_IS_MODEL: {
    meaning: 'The requested output file is the model file being read.',
    remedy: 'Write the output to a different path.',
  },
  SNAPSHOT_EXISTS: {
    meaning:
      'A snapshot already exists at the path the new one was to be written to.',
    remedy:
      'Write the new snapshot to a free path, or remove the existing file first.',
  },
  SNAPSHOT_INCOMPLETE: {
    meaning:
      'A stored snapshot manifest names a record revision the history no longer holds.',
    remedy:
      'Restore the history archive, or compare against a snapshot whose revisions are still present.',
  },
  BINDING_RANGE_MISSING: {
    meaning:
      'A binding claims a range of lines the bound file no longer reaches.',
    remedy:
      'Rebind that part to the lines the claim is about, or restore the file.',
  },
  DESCRIPTION_CONTRADICTED: {
    meaning:
      'A described relation is not the dependency the code has: a declared edge is absent, or a dependency between described parts is undeclared.',
    remedy:
      'Correct the relations or the code, then reconcile again - a binding digest cannot settle this.',
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
  OUTCOME_NOT_RUN: {
    meaning:
      'A stated outcome has no run behind it: no receipt names the command that produced it.',
    remedy: 'Run the check and record its receipt, or drop the outcome.',
  },
  UNKNOWN_LAYER: {
    meaning:
      'The layer or filter value asked for is outside the contract enum it belongs to.',
    remedy:
      'Ask for a zone, kind or interaction kind the contract lists, or clear the filter.',
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
