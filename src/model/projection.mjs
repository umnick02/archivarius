/**
 * A view of a snapshot is a projection, not a filter drawn over the whole of it.
 * Two projections live here: a layer, which decides which parts and relations the
 * view contains at all, and the mount set, which decides how many of them are
 * worth keeping alive at the current camera. Both are decisions about the model,
 * so neither touches React or the DOM.
 *
 * @typedef {{ key: string, kind: string, zone: string,
 *   children?: unknown[] }} Node
 * @typedef {{ key: string, from: string, to: string, kind: string }} Relation
 * @typedef {{ nodes: Node[], relations: Relation[] }} Model
 * @typedef {{ nodes: Map<string, Node>, parents: Map<string, string | null> }} Graph
 * @typedef {{ outside: string, direction: 'incoming' | 'outgoing',
 *   relations: string[] }} Boundary
 * @typedef {{ axis: 'all' | 'kind' | 'zone', layer: string, parts: Set<string>,
 *   relations: string[], boundaries: Boundary[] }} Projection
 * @typedef {{ key: string, parent: string | null, x: number, y: number,
 *   width: number, height: number }} Box
 */

// The two axes a layer can name. A kind is a way of interacting, a zone is a kind
// of work; the rendering contract owns both vocabularies and this only reads them.
export const relationKinds = ['data', 'command', 'state'];
export const zones = [
  'presentation',
  'application',
  'infrastructure',
  'pure',
  'external',
];

// Below this many simultaneously visible parts, releasing one costs a remount and
// buys nothing, so the whole level stays mounted and small models behave exactly
// as they did. `responsive-at-scale` budgets 500 parts; the screenful this keeps
// is a fraction of that.
export const mountBudget = 120;
// A screen of slack on every side, so a part is already mounted by the time a pan
// brings it into view rather than appearing when it arrives.
export const mountMargin = 1;

/**
 * Which vocabulary a layer belongs to. A caller that guessed would silently read
 * a zone as a kind and project nothing.
 *
 * @param {string} layer
 * @returns {'all' | 'kind' | 'zone'}
 */
export function layerAxis(layer) {
  if (layer === 'all') return 'all';
  if (relationKinds.includes(layer)) return 'kind';
  if (zones.includes(layer)) return 'zone';
  throw new Error('UNKNOWN_LAYER:' + layer);
}

const ancestors = (key, graph) => {
  const chain = [];
  let parent = graph.parents.get(key) ?? null;
  while (parent !== null) {
    chain.push(parent);
    parent = graph.parents.get(parent) ?? null;
  }
  return chain;
};

/**
 * The view a layer names: the parts it contains, the relations among them, and
 * every relation that leaves it collapsed into one boundary per outside
 * participant and direction. A reader is told what the view left out; they are
 * not shown a faded copy of it.
 *
 * @param {Model} model
 * @param {Graph} graph
 * @param {string} layer
 * @returns {Projection}
 */
export function projectLayer(model, graph, layer) {
  const axis = layerAxis(layer);
  if (axis === 'all')
    return {
      axis,
      layer,
      parts: new Set(graph.nodes.keys()),
      relations: model.relations.map((edge) => edge.key),
      boundaries: [],
    };
  const parts = new Set();
  const relations = [];
  if (axis === 'zone') {
    for (const [key, node] of graph.nodes)
      if (node.zone === layer) parts.add(key);
    for (const key of [...parts])
      for (const parent of ancestors(key, graph)) parts.add(parent);
    for (const edge of model.relations)
      if (parts.has(edge.from) && parts.has(edge.to)) relations.push(edge.key);
  } else {
    for (const edge of model.relations) {
      if (edge.kind !== layer) continue;
      relations.push(edge.key);
      for (const endpoint of [edge.from, edge.to]) {
        parts.add(endpoint);
        for (const parent of ancestors(endpoint, graph)) parts.add(parent);
      }
    }
  }
  // A relation with one foot in the view and one outside it is the boundary; one
  // with neither foot inside belongs to another view entirely.
  const boundaries = new Map();
  const drawn = new Set(relations);
  for (const edge of model.relations) {
    if (drawn.has(edge.key)) continue;
    const from = parts.has(edge.from),
      to = parts.has(edge.to);
    if (from === to) continue;
    const outside = from ? edge.to : edge.from;
    const direction = from ? 'outgoing' : 'incoming';
    const key = outside + '/' + direction;
    if (!boundaries.has(key))
      boundaries.set(key, { outside, direction, relations: [] });
    boundaries.get(key).relations.push(edge.key);
  }
  return {
    axis,
    layer,
    parts,
    relations,
    boundaries: [...boundaries.values()],
  };
}

/**
 * Whether a projection draws a part. A container that holds nothing of the view
 * is not part of it either, which is what makes a layer a view and not a tint.
 *
 * @param {Projection} projection
 * @param {string} key
 * @returns {boolean}
 */
export const drawsPart = (projection, key) =>
  projection.axis === 'all' || projection.parts.has(key);

/**
 * Whether a projection draws a relation. Every member of a bundled arrow has to
 * belong to the view, or the arrow would claim an exchange the view excluded.
 *
 * @param {Projection} projection
 * @param {{ relations: { key: string }[] }} bundle
 * @returns {boolean}
 */
export function drawsBundle(projection, bundle) {
  if (projection.axis === 'all') return true;
  const drawn = new Set(projection.relations);
  return bundle.relations.every((relation) => drawn.has(relation.key));
}

/**
 * The parts worth mounting at the current camera: the ones the viewport reaches,
 * plus a screen of margin, plus the containers they are drawn inside — a child
 * without its container has nothing to be positioned against. Below the budget
 * nothing is released at all.
 *
 * @param {{ layout: { nodes: Record<string, Box> }, visible: Iterable<string>,
 *   viewport: { x: number, y: number, zoom: number },
 *   size: { width: number, height: number },
 *   budget?: number, margin?: number }} options
 * @returns {Set<string>}
 */
export function mountedParts({
  layout,
  visible,
  viewport,
  size,
  budget = mountBudget,
  margin = mountMargin,
}) {
  const candidates = [...visible];
  if (candidates.length <= budget) return new Set(candidates);
  const frame = {
    x: (-viewport.x - size.width * margin) / viewport.zoom,
    y: (-viewport.y - size.height * margin) / viewport.zoom,
    width: (size.width * (1 + 2 * margin)) / viewport.zoom,
    height: (size.height * (1 + 2 * margin)) / viewport.zoom,
  };
  const mounted = new Set();
  for (const key of candidates) {
    const box = layout.nodes[key];
    if (
      !box ||
      box.x >= frame.x + frame.width ||
      box.x + box.width <= frame.x ||
      box.y >= frame.y + frame.height ||
      box.y + box.height <= frame.y
    )
      continue;
    mounted.add(key);
    let parent = box.parent;
    while (parent && !mounted.has(parent)) {
      mounted.add(parent);
      parent = layout.nodes[parent]?.parent ?? null;
    }
  }
  return mounted;
}
