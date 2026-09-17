// What a contract change costs a consumer.
//
// A published version is a promise: a minor release may add to the contract, and
// only a major may take anything away. This module makes that promise checkable.
// It reduces a JSON Schema to the facts a consumer can be held to — which fields
// exist, which of them are required, which values a field accepts, which bounds it
// is inside — and grades the difference between two such readings as `additive`
// (a new optional field, a new value, a looser bound) or `breaking` (a removed or
// newly required field, a withdrawn value, a tighter bound).
//
// The reading names no field of any particular schema: it walks whatever it is
// given. Every schema location is keyed by where it sits — `.records[]` for the
// items of a property, `{}` for an additional-property schema — and a schema that
// discriminates between shapes (`oneOf` branches that pin one property to
// disjoint values) yields one keyed shape per variant, `[type=document]`, so a
// field required by one shape alone is still seen when it becomes required by all.
//
// It never follows `$ref`: a reference is recorded as the promise it is, and the
// definition it names is graded at its own location. That keeps the reading finite
// on a recursive contract and keeps one change reported once.
//
// Two approximations are deliberate, and both err towards reporting a change: a
// branch set this reading cannot discriminate is folded into one shape that keeps
// the loosest bound and the widest value set of its branches, and a changed
// `pattern` is graded breaking because no reading can tell a widened regular
// expression from a narrowed one.
import { ArchitectureError } from './errors.mjs';

/**
 * The contract majors this library reads. A snapshot from a newer major is
 * refused by name instead of being reported as a heap of unreadable fields.
 */
export const supportedContractVersion = 4;

/**
 * @typedef {{ ref?: string, refs?: string[], types?: string[],
 *   values?: string[], forbidden?: boolean, closed?: boolean,
 *   required?: string[], optional?: string[],
 *   bounds?: Record<string, number | boolean | string> }} Shape
 * @typedef {{ title: string | null, version: number | null,
 *   locations: Record<string, Shape> }} ContractShape
 * @typedef {{ grade: 'additive' | 'breaking', kind: string, location: string,
 *   field?: string, keyword?: string, lost?: string[], gained?: string[],
 *   was?: string, now?: string }} ContractChange
 */

const lowerBounds = [
  'minimum',
  'exclusiveMinimum',
  'minLength',
  'minItems',
  'minProperties',
];
const upperBounds = [
  'maximum',
  'exclusiveMaximum',
  'maxLength',
  'maxItems',
  'maxProperties',
];
const flagBounds = ['uniqueItems'];
const exactBounds = ['pattern', 'format', 'multipleOf'];
const boundKeywords = [
  ...lowerBounds,
  ...upperBounds,
  ...flagBounds,
  ...exactBounds,
];

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// A value set is compared as text, so a number and the string that spells it are
// one value: a contract states values, and a reader reads them written down.
const valueText = (value) =>
  typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));

const sorted = (values) => [...values].sort();

const newFacts = () => ({
  refs: new Set(),
  types: /** @type {Set<string> | null} */ (null),
  values: /** @type {Set<string> | null} */ (null),
  bounds: /** @type {Record<string, number | boolean | string>} */ ({}),
  forbidden: false,
  closed: false,
  required: new Set(),
  props: /** @type {Map<string, unknown[]>} */ (new Map()),
  items: /** @type {unknown[]} */ ([]),
  entries: /** @type {unknown[]} */ ([]),
  names: /** @type {unknown[]} */ ([]),
});

const cloneFacts = (facts) => ({
  ...facts,
  refs: new Set(facts.refs),
  types: facts.types && new Set(facts.types),
  values: facts.values && new Set(facts.values),
  bounds: { ...facts.bounds },
  required: new Set(facts.required),
  props: new Map([...facts.props].map(([name, raw]) => [name, [...raw]])),
  items: [...facts.items],
  entries: [...facts.entries],
  names: [...facts.names],
});

const intersect = (left, right) =>
  new Set([...left].filter((value) => right.has(value)));

const union = (left, right) => new Set([...left, ...right]);

const typeSet = (type) =>
  new Set((Array.isArray(type) ? type : [type]).map(String));

const valueSet = (values) => new Set(values.map(valueText));

// Two constraints on one place are read together: a value has to satisfy both, so
// the value sets narrow and the bounds keep whichever is tighter.
function andBounds(bounds, added) {
  for (const keyword of boundKeywords) {
    if (added[keyword] === undefined) continue;
    const held = bounds[keyword];
    if (held === undefined) bounds[keyword] = added[keyword];
    else if (lowerBounds.includes(keyword))
      bounds[keyword] = Math.max(Number(held), Number(added[keyword]));
    else if (upperBounds.includes(keyword))
      bounds[keyword] = Math.min(Number(held), Number(added[keyword]));
    else if (flagBounds.includes(keyword))
      bounds[keyword] = Boolean(held) || Boolean(added[keyword]);
  }
}

/**
 * One reading of everything that constrains a place, with the branch sets it
 * could not read as a single shape handed back to the caller.
 * @param {unknown[]} schemas
 */
function flatten(schemas) {
  const facts = newFacts();
  const groups = /** @type {unknown[][]} */ ([]);
  const stack = [...schemas];
  while (stack.length) {
    const node = stack.shift();
    if (node === false) {
      facts.forbidden = true;
      continue;
    }
    if (!isObject(node)) continue;
    if (typeof node.$ref === 'string') facts.refs.add(node.$ref);
    if (node.type !== undefined) {
      const read = typeSet(node.type);
      facts.types = facts.types ? intersect(facts.types, read) : read;
    }
    const stated = Array.isArray(node.enum)
      ? valueSet(node.enum)
      : 'const' in node
        ? valueSet([node.const])
        : null;
    if (stated)
      facts.values = facts.values ? intersect(facts.values, stated) : stated;
    andBounds(facts.bounds, node);
    if (
      node.additionalProperties === false ||
      node.unevaluatedProperties === false
    )
      facts.closed = true;
    for (const name of Array.isArray(node.required) ? node.required : [])
      facts.required.add(String(name));
    for (const [name, child] of Object.entries(
      isObject(node.properties) ? node.properties : {},
    )) {
      if (!facts.props.has(name)) facts.props.set(name, []);
      facts.props.get(name)?.push(child);
    }
    if (node.items !== undefined) facts.items.push(node.items);
    if (isObject(node.additionalProperties))
      facts.entries.push(node.additionalProperties);
    if (isObject(node.propertyNames)) facts.names.push(node.propertyNames);
    if (Array.isArray(node.allOf)) stack.push(...node.allOf);
    for (const keyword of ['oneOf', 'anyOf']) {
      const branches = node[keyword];
      if (!Array.isArray(branches) || !branches.length) continue;
      if (branches.length === 1) stack.push(branches[0]);
      else groups.push(branches);
    }
  }
  return { facts, groups };
}

/** Fold a set of branches into the one shape they all still promise. */
function orFacts(branches) {
  const read = branches.map((branch) => flatten([branch]).facts);
  const folded = cloneFacts(read[0]);
  for (const other of read.slice(1)) {
    folded.refs = union(folded.refs, other.refs);
    folded.types =
      folded.types && other.types ? union(folded.types, other.types) : null;
    folded.values =
      folded.values && other.values ? union(folded.values, other.values) : null;
    folded.forbidden = folded.forbidden && other.forbidden;
    folded.closed = folded.closed && other.closed;
    folded.required = intersect(folded.required, other.required);
    for (const keyword of boundKeywords) {
      const held = folded.bounds[keyword];
      const added = other.bounds[keyword];
      if (held === undefined || added === undefined)
        delete folded.bounds[keyword];
      else if (lowerBounds.includes(keyword))
        folded.bounds[keyword] = Math.min(Number(held), Number(added));
      else if (upperBounds.includes(keyword))
        folded.bounds[keyword] = Math.max(Number(held), Number(added));
      else if (flagBounds.includes(keyword))
        folded.bounds[keyword] = Boolean(held) && Boolean(added);
      else if (held !== added) delete folded.bounds[keyword];
    }
    for (const [name, raw] of other.props) {
      if (!folded.props.has(name)) folded.props.set(name, []);
      folded.props.get(name)?.push(...raw);
    }
    folded.items.push(...other.items);
    folded.entries.push(...other.entries);
    folded.names.push(...other.names);
  }
  return folded;
}

/** Read one facts object into another, keeping both constraints. */
function andFacts(facts, other) {
  facts.refs = union(facts.refs, other.refs);
  facts.types =
    facts.types && other.types
      ? intersect(facts.types, other.types)
      : (facts.types ?? other.types);
  facts.values =
    facts.values && other.values
      ? intersect(facts.values, other.values)
      : (facts.values ?? other.values);
  facts.forbidden = facts.forbidden || other.forbidden;
  facts.closed = facts.closed || other.closed;
  for (const name of other.required) facts.required.add(name);
  andBounds(facts.bounds, other.bounds);
  for (const [name, raw] of other.props) {
    if (!facts.props.has(name)) facts.props.set(name, []);
    facts.props.get(name)?.push(...raw);
  }
  facts.items.push(...other.items);
  facts.entries.push(...other.entries);
  facts.names.push(...other.names);
  return facts;
}

const valuesOf = (raws) => flatten(raws).facts.values;

/**
 * The property a branch set decides on, when it has one: every branch pins it,
 * and no two branches accept the same value. That is what makes a variant
 * nameable, and naming it is what keeps a field required by one shape alone from
 * being read as optional everywhere.
 * @param {unknown[]} branches
 */
function discriminate(branches) {
  const read = branches.map((branch) => flatten([branch]).facts);
  const names = sorted(
    new Set(read.flatMap((facts) => [...facts.props.keys()])),
  );
  for (const name of names) {
    const sets = read.map((facts) => {
      const raw = facts.props.get(name);
      return raw ? valuesOf(raw) : null;
    });
    if (sets.some((set) => !set || !set.size)) continue;
    const seen = new Set();
    let disjoint = true;
    for (const set of sets)
      for (const value of set ?? []) {
        if (seen.has(value)) disjoint = false;
        seen.add(value);
      }
    if (!disjoint) continue;
    return branches.map((schema, index) => ({
      label: '[' + name + '=' + sorted(sets[index] ?? []).join('|') + ']',
      schema,
    }));
  }
  return null;
}

/**
 * Every shape a place promises, one per named variant.
 * @param {unknown[]} raws
 * @returns {{ label: string, facts: ReturnType<typeof newFacts> }[]}
 */
function shapesOf(raws, depth = 0) {
  const { facts, groups } = flatten(raws);
  const labeled = depth > 4 ? [] : groups.map(discriminate);
  groups.forEach((group, index) => {
    if (!labeled[index]) andFacts(facts, orFacts(group));
  });
  const usable = labeled.filter(Boolean);
  if (!usable.length) return [{ label: '', facts }];
  let combos = [{ label: '', branches: /** @type {unknown[]} */ ([]) }];
  for (const variants of usable) {
    const grown = combos.flatMap((combo) =>
      (variants ?? []).map((variant) => ({
        label: combo.label + variant.label,
        branches: [...combo.branches, variant.schema],
      })),
    );
    if (grown.length > 32) break;
    combos = grown;
  }
  return combos.flatMap((combo) =>
    shapesOf(combo.branches, depth + 1).map((sub) => ({
      label: combo.label + sub.label,
      facts: andFacts(cloneFacts(facts), sub.facts),
    })),
  );
}

/** @returns {Shape | null} */
function describe(facts) {
  /** @type {Shape} */
  const shape = {};
  const refs = sorted(facts.refs);
  if (refs.length === 1) shape.ref = refs[0];
  else if (refs.length > 1) shape.refs = refs;
  if (facts.types) shape.types = sorted(facts.types);
  if (facts.values) shape.values = sorted(facts.values);
  if (facts.forbidden) shape.forbidden = true;
  if (facts.closed) shape.closed = true;
  // A required field is not listed twice: the fields of a shape are the two
  // lists read together, and that is the one place requiredness is stated.
  if (facts.required.size) shape.required = sorted(facts.required);
  const optional = sorted(facts.props.keys()).filter(
    (name) => !facts.required.has(name),
  );
  if (optional.length) shape.optional = optional;
  /** @type {Record<string, number | boolean | string>} */
  const bounds = {};
  for (const keyword of boundKeywords)
    if (facts.bounds[keyword] !== undefined)
      bounds[keyword] = facts.bounds[keyword];
  if (Object.keys(bounds).length) shape.bounds = bounds;
  return Object.keys(shape).length ? shape : null;
}

function emit(locations, key, raws, depth) {
  if (depth > 8) return;
  for (const { label, facts } of shapesOf(raws)) {
    const at = key + label;
    if (Object.hasOwn(locations, at)) continue;
    const shape = describe(facts);
    if (shape) locations[at] = shape;
    for (const name of sorted(facts.props.keys()))
      emit(locations, at + '.' + name, facts.props.get(name) ?? [], depth + 1);
    if (facts.items.length) emit(locations, at + '[]', facts.items, depth + 1);
    if (facts.entries.length)
      emit(locations, at + '{}', facts.entries, depth + 1);
    if (facts.names.length)
      emit(locations, at + '{key}', facts.names, depth + 1);
  }
}

/**
 * The contract major a value states: a schema states it as the version it pins,
 * a model or a snapshot as the version it carries, and a number states itself.
 * @param {unknown} value
 * @returns {number | null}
 */
export function contractVersion(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (!isObject(value)) return null;
  if (typeof value.version === 'number') return value.version;
  const properties = isObject(value.properties) ? value.properties : null;
  const declared = properties && properties.version;
  if (!isObject(declared)) return null;
  if (typeof declared.const === 'number') return declared.const;
  const stated = Array.isArray(declared.enum)
    ? declared.enum.filter((entry) => typeof entry === 'number')
    : [];
  return stated.length ? Math.max(...stated) : null;
}

/**
 * Read a contract schema into the facts a consumer can be held to.
 * @param {unknown} schema
 * @returns {ContractShape}
 */
export function contractShape(schema) {
  /** @type {Record<string, Shape>} */
  const locations = {};
  emit(locations, '', [schema], 0);
  const defs = isObject(schema) && isObject(schema.$defs) ? schema.$defs : {};
  for (const name of Object.keys(defs).sort())
    emit(locations, '$defs/' + name, [defs[name]], 0);
  return {
    title:
      isObject(schema) && typeof schema.title === 'string'
        ? schema.title
        : null,
    version: contractVersion(schema),
    locations: Object.fromEntries(
      Object.keys(locations)
        .sort()
        .map((key) => [key, locations[key]]),
    ),
  };
}

const shapeOf = (value) =>
  isObject(value) && isObject(value.locations)
    ? /** @type {ContractShape} */ (value)
    : contractShape(value);

const listOf = (shape, key) => {
  const held = shape[key];
  return Array.isArray(held) ? held : [];
};

const fieldsOf = (shape) => [
  ...listOf(shape, 'required'),
  ...listOf(shape, 'optional'),
];

const setOf = (shape, key) => {
  if (key === 'refs')
    return shape.refs ?? (shape.ref ? [shape.ref] : undefined);
  return shape[key];
};

// A value set that appears where there was none is a new restriction, and one
// that disappears is a relaxation: absent means anything was accepted.
/** @returns {ContractChange[]} */
function setChanges(subject, location, was, now) {
  /** @type {ContractChange[]} */
  const changes = [];
  if (!was && !now) return changes;
  if (!was)
    return [
      {
        grade: 'breaking',
        kind: subject + '-restricted',
        location,
        now: sorted(now ?? []).join('|'),
      },
    ];
  if (!now)
    return [
      {
        grade: 'additive',
        kind: subject + '-open',
        location,
        was: sorted(was).join('|'),
      },
    ];
  const lost = was.filter((value) => !now.includes(value));
  const gained = now.filter((value) => !was.includes(value));
  if (lost.length)
    changes.push({
      grade: 'breaking',
      kind: subject + '-removed',
      location,
      lost,
    });
  if (gained.length)
    changes.push({
      grade: 'additive',
      kind: subject + '-added',
      location,
      gained,
    });
  return changes;
}

/** @returns {ContractChange[]} */
function boundChanges(location, was, now) {
  /** @type {ContractChange[]} */
  const changes = [];
  for (const keyword of boundKeywords) {
    const before = was?.[keyword];
    const after = now?.[keyword];
    if (before === after) continue;
    const stated = {
      location,
      keyword,
      was: String(before),
      now: String(after),
    };
    if (exactBounds.includes(keyword))
      changes.push({ grade: 'breaking', kind: 'bound-changed', ...stated });
    else if (flagBounds.includes(keyword))
      changes.push({
        grade: after ? 'breaking' : 'additive',
        kind: after ? 'bound-tightened' : 'bound-relaxed',
        ...stated,
      });
    else {
      const low = lowerBounds.includes(keyword);
      const held = Number(before ?? (low ? -Infinity : Infinity));
      const added = Number(after ?? (low ? -Infinity : Infinity));
      const tighter = low ? added > held : added < held;
      changes.push({
        grade: tighter ? 'breaking' : 'additive',
        kind: tighter ? 'bound-tightened' : 'bound-relaxed',
        ...stated,
      });
    }
  }
  return changes;
}

/**
 * Grade the difference between two contracts. `additive` is what a minor release
 * may carry; anything a consumer's valid document could fail on is `breaking`.
 * @param {unknown} previous a contract schema, or a shape already read from one
 * @param {unknown} next the contract as it stands
 */
export function gradeContract(previous, next) {
  const before = shapeOf(previous);
  const after = shapeOf(next);
  /** @type {ContractChange[]} */
  const changes = [];
  const keys = sorted(
    new Set([
      ...Object.keys(before.locations),
      ...Object.keys(after.locations),
    ]),
  );
  for (const location of keys) {
    const was = before.locations[location];
    const now = after.locations[location];
    if (!now) {
      changes.push({ grade: 'breaking', kind: 'shape-removed', location });
      continue;
    }
    if (!was) {
      changes.push({ grade: 'additive', kind: 'shape-added', location });
      continue;
    }
    const wasProps = fieldsOf(was);
    const nowProps = fieldsOf(now);
    const wasRequired = listOf(was, 'required');
    const nowRequired = listOf(now, 'required');
    for (const field of wasProps.filter((name) => !nowProps.includes(name)))
      changes.push({
        grade: 'breaking',
        kind: 'field-removed',
        location,
        field,
      });
    for (const field of nowProps.filter((name) => !wasProps.includes(name)))
      changes.push(
        nowRequired.includes(field)
          ? {
              grade: 'breaking',
              kind: 'field-added-required',
              location,
              field,
            }
          : { grade: 'additive', kind: 'field-added', location, field },
      );
    for (const field of nowRequired.filter(
      (name) => !wasRequired.includes(name) && wasProps.includes(name),
    ))
      changes.push({
        grade: 'breaking',
        kind: 'field-required',
        location,
        field,
      });
    for (const field of wasRequired.filter(
      (name) => !nowRequired.includes(name),
    ))
      changes.push({
        grade: 'additive',
        kind: 'field-optional',
        location,
        field,
      });
    for (const [subject, key] of [
      ['value', 'values'],
      ['type', 'types'],
      ['ref', 'refs'],
    ])
      changes.push(
        ...setChanges(subject, location, setOf(was, key), setOf(now, key)),
      );
    for (const [key, closed, opened] of [
      ['closed', 'object-closed', 'object-opened'],
      ['forbidden', 'field-forbidden', 'field-permitted'],
    ])
      if (Boolean(was[key]) !== Boolean(now[key]))
        changes.push(
          now[key]
            ? { grade: 'breaking', kind: closed, location }
            : { grade: 'additive', kind: opened, location },
        );
    changes.push(...boundChanges(location, was.bounds, now.bounds));
  }
  const breaking = changes.filter((change) => change.grade === 'breaking');
  const additive = changes.filter((change) => change.grade === 'additive');
  return {
    grade: breaking.length
      ? 'breaking'
      : additive.length
        ? 'additive'
        : 'unchanged',
    previous: before.version,
    next: after.version,
    changes,
    breaking,
    additive,
  };
}

/**
 * Refuse a snapshot written against a contract major this library cannot read.
 * A newer major may have withdrawn a field this library requires, so reading it
 * as far as validation would report a heap of failures about fields instead of
 * the one fact that matters.
 * @param {unknown} snapshot
 * @param {unknown} [library]
 * @returns {number | null} the contract major the snapshot states
 */
export function assertContractSupported(
  snapshot,
  library = supportedContractVersion,
) {
  const read = contractVersion(snapshot);
  const supported = contractVersion(library);
  if (read === null || supported === null || read <= supported) return read;
  throw new ArchitectureError(
    'CONTRACT_TOO_NEW',
    ['contract version ' + read + ' is newer than the supported ' + supported],
    [
      {
        code: 'CONTRACT_TOO_NEW',
        path: '/version',
        field: 'version',
        value: String(read),
        expected:
          'A contract version this library reads, at most ' + supported + '.',
      },
    ],
  );
}
