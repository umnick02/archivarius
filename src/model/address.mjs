// The view a reader reached, as a value.
//
// A map is navigated by gestures, but what a gesture produces is a view: a part
// selected, a container opened, a zoom, an open panel, and the filters in force.
// This module is the only place that knows how such a view is written into a page
// address and read back out of it, so a link restores what its sender was looking
// at and a reload does not throw the reader back to the entry point.
//
// Two rules shape everything here. A view belongs to one mount, so every field is
// named under that mount's key and two maps on one page never overwrite each
// other or the host page's own parameters. And a field the map cannot act on is
// dropped rather than raised, except where the field names something the contract
// does hold — a record or a layer — because those are the two cases where the
// reader is better served by a stated refusal than by a silently different view.
import { ArchitectureError, explainDiagnostics } from './errors.mjs';
import { relationKinds, zones } from './projection.mjs';
import { primaryFields, viewTypes } from './project-view.mjs';
import { kindOrder } from './zoom.mjs';

/** The address fields, in the order the address writes them. */
export const addressFields = Object.freeze([
  'at',
  'level',
  'zoom',
  'panel',
  'record',
  'view',
  'query',
  'recordType',
  'anchor',
  'edge',
  'open',
  'zone',
  'kind',
  'relation',
]);

/** The panels a view can name; an unknown one is no panel at all. */
export const panelKinds = Object.freeze([
  'node',
  'relation',
  'record',
  'project',
  'contracts',
  'about',
]);

/**
 * The surfaces a reader can open beside the drawing. A view carries which of them
 * were open, so a link restores the same reading its sender had, and a name this
 * map has no surface for is no surface at all.
 */
export const surfaceKinds = Object.freeze(['neighbours', 'reading', 'options']);

/**
 * What each filter accepts, read off the contract's own tables so a value is
 * never listed twice and a new zone or interaction kind reaches the filters the
 * moment the contract states it. `all` is the filter that removes nothing.
 */
export const filterVocabularies = Object.freeze({
  zone: Object.freeze(['all', ...zones]),
  kind: Object.freeze(['all', ...kindOrder]),
  relation: Object.freeze(['all', ...relationKinds]),
});

const filterFields = Object.freeze(['zone', 'kind', 'relation']);

/** The view a map opens in: nothing selected, nothing filtered out. */
export const emptyView = Object.freeze({
  at: null,
  level: null,
  zoom: null,
  panel: null,
  record: null,
  view: null,
  query: null,
  recordType: null,
  anchor: null,
  edge: null,
  open: Object.freeze([]),
  filters: Object.freeze({ zone: 'all', kind: 'all', relation: 'all' }),
});

/**
 * The name a mount writes its fields under. It comes from the host element the
 * library was mounted into, reduced to the characters an address carries plainly,
 * so the same page keeps two maps apart and the same element keeps its own view
 * across a reload. A host that named nothing gets `map`.
 * @param {unknown} id
 * @returns {string}
 */
export function addressKey(id) {
  const text = id === null || id === undefined ? '' : String(id);
  return text.replace(/[^A-Za-z0-9_-]/g, '') || 'map';
}

const params = (search) =>
  new URLSearchParams(
    typeof search === 'string' ? search.replace(/^[?#]/, '') : '',
  );

/**
 * Read one mount's view out of a page address. Fields belonging to another mount
 * or to the host page are not read, and a field the map cannot act on — an
 * unnamed panel, a zoom that is not a positive number, a blank key — is left at
 * the opening view's value.
 * @param {string | undefined} search
 * @param {{ key?: unknown }} [options]
 */
export function parseAddress(search, options = {}) {
  const held = params(search);
  const name = addressKey(options.key);
  const read = (field) => {
    const raw = held.get(name + '.' + field);
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text || null;
  };
  const panel = read('panel');
  const zoom = Number(read('zoom'));
  const filters = {};
  // A filter value is kept as it was written, even when the contract does not
  // hold it, so `checkAddress` can state the refusal instead of the map quietly
  // showing an unfiltered view the address did not ask for.
  for (const field of filterFields) filters[field] = read(field) ?? 'all';
  return {
    at: read('at'),
    level: read('level'),
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : null,
    panel: panelKinds.includes(panel) ? panel : null,
    record: read('record'),
    view: ['overview', 'all', ...Object.keys(viewTypes)].includes(read('view'))
      ? read('view')
      : null,
    query: read('query'),
    recordType: Object.keys(primaryFields).includes(read('recordType'))
      ? read('recordType')
      : null,
    anchor: read('anchor'),
    edge: read('edge'),
    // One order in, one order out: the surfaces are read in the order this module
    // lists them, so two links to the same reading are the same link.
    open: surfaceKinds.filter((name) =>
      (read('open') ?? '').split(',').includes(name),
    ),
    filters,
  };
}

/**
 * Write one mount's view into a page address, returning the query string. Every
 * other parameter — another mount's, the host page's — is carried through
 * untouched, and a field still at the opening view's value is removed rather
 * than spelled out, so a link says only what its sender changed.
 * @param {string | undefined} search
 * @param {typeof emptyView} view
 * @param {{ key?: unknown }} [options]
 * @returns {string}
 */
export function writeAddress(search, view, options = {}) {
  const held = params(search);
  const name = addressKey(options.key);
  const set = (field, value, opening) => {
    const param = name + '.' + field;
    if (value === null || value === undefined || value === opening)
      held.delete(param);
    else held.set(param, String(value));
  };
  set('at', view?.at, null);
  set('level', view?.level, null);
  // A zoom carries four decimals: enough to restore the frame, short enough that
  // the address stays readable to the person pasting it.
  const zoom = view?.zoom;
  set(
    'zoom',
    typeof zoom === 'number' && Number.isFinite(zoom)
      ? Number(zoom.toFixed(4))
      : null,
    null,
  );
  set('panel', view?.panel, null);
  set('record', view?.record, null);
  for (const field of ['view', 'query', 'recordType', 'anchor'])
    set(field, view?.[field], null);
  set('edge', view?.edge, null);
  const open = surfaceKinds.filter((name) => view?.open?.includes(name));
  set('open', open.length ? open.join(',') : null, null);
  const filters = view?.filters ?? emptyView.filters;
  for (const field of filterFields) set(field, filters[field], 'all');
  return held.toString();
}

/**
 * What an address is checked against: the parts the map currently draws and the
 * interactions the model declares. Taking a snapshot rather than the model keeps
 * this module's reading independent of how a model is shaped.
 * @param {{ relations?: { key: string }[] }} model
 * @param {{ nodes: Map<string, unknown> }} graph
 * @param {{ records: { key: string }[] } | null} [project]
 */
export function addressSnapshot(model, graph, project = null) {
  return {
    parts: new Set(graph?.nodes?.keys() ?? []),
    relations: new Set(
      (model?.relations ?? []).map((relation) => relation.key),
    ),
    records: new Set((project?.records ?? []).map((record) => record.key)),
  };
}

/**
 * Read an address against a snapshot and state what it cannot restore: a part or
 * container the map does not draw, an interaction the model no longer declares,
 * a filter value the contract does not hold. Each statement names the field, the
 * record, what was read and what would have been accepted.
 * @param {typeof emptyView} view
 * @param {ReturnType<typeof addressSnapshot>} snapshot
 */
export function checkAddress(view, snapshot) {
  const raw = [];
  const parts = snapshot?.parts ?? new Set();
  const relations = snapshot?.relations ?? new Set();
  for (const field of ['at', 'level']) {
    const key = view?.[field];
    if (key && !parts.has(key))
      raw.push({
        code: 'UNKNOWN_NODE',
        path: '/' + field,
        field,
        record: key,
        expected: 'The key of a part the map draws.',
      });
  }
  if (view?.edge && !relations.has(view.edge))
    raw.push({
      code: 'UNKNOWN_RECORD',
      path: '/edge',
      field: 'edge',
      record: view.edge,
      expected: 'The key of an interaction the model declares.',
    });
  if (view?.record && !snapshot?.records?.has(view.record))
    raw.push({
      code: 'UNKNOWN_RECORD',
      path: '/record',
      field: 'record',
      record: view.record,
      expected: 'The key of a record the project declares.',
    });
  for (const field of filterFields) {
    const value = view?.filters?.[field] ?? 'all';
    if (!filterVocabularies[field].includes(value))
      raw.push({
        code: 'UNKNOWN_LAYER',
        path: '/filters/' + field,
        field,
        expected: 'One of: ' + filterVocabularies[field].join(', ') + '.',
      });
  }
  // `explainDiagnostics` is the one place that phrases what was read, so a
  // refusal about an address reads like every other refusal the library makes.
  return explainDiagnostics(raw, view ?? emptyView);
}

/**
 * The same reading, raised: one error carrying every statement, or `null` when
 * the address describes a view the map can restore.
 * @param {typeof emptyView} view
 * @param {ReturnType<typeof addressSnapshot>} snapshot
 * @returns {ArchitectureError | null}
 */
export function addressFailure(view, snapshot) {
  const diagnostics = checkAddress(view, snapshot);
  if (!diagnostics.length) return null;
  return new ArchitectureError(
    diagnostics[0].code,
    diagnostics.map((issue) =>
      issue.record ? issue.code + ':' + issue.record : issue.code,
    ),
    diagnostics,
  );
}

/**
 * Whether a filtered view keeps a part. A part is kept when every filter in
 * force accepts it — the filters are one view, not three views drawn over each
 * other.
 * @param {typeof emptyView.filters} filters
 * @param {{ kind?: string, zone?: string } | undefined} node
 */
export function keepsPart(filters, node) {
  if (!node) return false;
  const zone = filters?.zone ?? 'all';
  const kind = filters?.kind ?? 'all';
  return (
    (zone === 'all' || node.zone === zone) &&
    (kind === 'all' || node.kind === kind)
  );
}

/**
 * Whether a filtered view keeps an interaction.
 * @param {typeof emptyView.filters} filters
 * @param {{ kind?: string } | undefined} relation
 */
export function keepsRelation(filters, relation) {
  const kind = filters?.relation ?? 'all';
  return kind === 'all' || relation?.kind === kind;
}

const ancestors = (graph, key, into) => {
  for (let parent = graph?.parents?.get(key); parent; )
    if (into.has(parent)) break;
    else {
      into.add(parent);
      parent = graph.parents.get(parent);
    }
  return into;
};

/**
 * Apply a view's filters to the snapshot: which parts it still draws and which
 * interactions it still shows. A filter removes what is out of scope instead of
 * dimming it, so the reader is looking at a smaller map rather than a crowded one
 * with most of it greyed out.
 *
 * A kept part brings the containers it is drawn inside with it — a card cannot be
 * drawn outside its box — and an interaction is kept only when the view still
 * draws both of its ends. When an interaction filter is in force, a part that
 * takes part in none of the kept interactions is out of scope too: that is what
 * asking for one kind of exchange means.
 * @param {{ relations?: { key: string, from: string, to: string, kind: string }[] }} model
 * @param {{ nodes: Map<string, { kind?: string, zone?: string }>, parents: Map<string, string | null> }} graph
 * @param {typeof emptyView.filters} filters
 */
export function filterView(model, graph, filters) {
  const edges = model?.relations ?? [];
  const inForce = filterFields.some(
    (field) => (filters?.[field] ?? 'all') !== 'all',
  );
  if (!inForce)
    return {
      filtered: false,
      parts: new Set(graph?.nodes?.keys() ?? []),
      relations: new Set(edges.map((relation) => relation.key)),
    };
  const parts = new Set();
  for (const [key, node] of graph?.nodes ?? [])
    if (keepsPart(filters, node)) {
      parts.add(key);
      ancestors(graph, key, parts);
    }
  const relations = new Set();
  for (const relation of edges)
    if (
      keepsRelation(filters, relation) &&
      parts.has(relation.from) &&
      parts.has(relation.to)
    )
      relations.add(relation.key);
  if ((filters?.relation ?? 'all') !== 'all') {
    const touched = new Set();
    for (const relation of edges)
      if (relations.has(relation.key))
        for (const end of [relation.from, relation.to]) {
          touched.add(end);
          ancestors(graph, end, touched);
        }
    for (const key of [...parts]) if (!touched.has(key)) parts.delete(key);
  }
  return { filtered: true, parts, relations };
}

/**
 * What a selected part relates to, in the filtered view: the parts it receives
 * from and the parts it sends to, each entry naming the kind of exchange and the
 * interactions it stands for so the reader can follow one. Two exchanges of the
 * same kind with the same part are one neighbour carrying two interactions,
 * because that is one thing to follow, not two.
 * @param {{ incoming?: object[], outgoing?: object[] }} interfaces from `ArchitectureGraph.describe`
 * @param {typeof emptyView.filters} filters
 */
export function neighbourhood(interfaces, filters) {
  const side = (list, end) => {
    const groups = new Map();
    for (const relation of list ?? []) {
      if (!keepsRelation(filters, relation)) continue;
      const part = relation[end];
      const id = part + '\u0000' + relation.kind;
      const entry = groups.get(id) ?? {
        part,
        kind: relation.kind,
        relations: [],
      };
      entry.relations.push(relation.key);
      groups.set(id, entry);
    }
    return [...groups.values()].sort(
      (one, other) =>
        one.part.localeCompare(other.part) ||
        one.kind.localeCompare(other.kind),
    );
  };
  const incoming = side(interfaces?.incoming, 'from');
  const outgoing = side(interfaces?.outgoing, 'to');
  return { incoming, outgoing, total: incoming.length + outgoing.length };
}
