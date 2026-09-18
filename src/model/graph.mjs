import { checkStructure } from './structure.mjs';
import { aggregateImplementation } from './implementation.mjs';

function validate(model) {
  const diagnostics = checkStructure(model);
  const errors = diagnostics.map(
    (issue) => issue.code + ':' + (issue.path || '/'),
  );
  const nodes = new Map(),
    parents = new Map(),
    paths = new Map();
  const result = { errors, diagnostics, nodes, parents };
  const issue = (code, subject, path) => {
    errors.push(code + (subject ? ':' + subject : ''));
    diagnostics.push({ code, path, ...(subject ? { subject } : {}) });
  };
  if (errors.length) return result;
  function walk(node, parent, path) {
    if (nodes.has(node.key)) {
      issue('DUPLICATE_NODE', node.key, path + '/key');
      return;
    }
    nodes.set(node.key, node);
    parents.set(node.key, parent);
    paths.set(node.key, path);
    node.children?.forEach((child, i) =>
      walk(child, node.key, path + '/children/' + i),
    );
  }
  model.nodes.forEach((node, i) => walk(node, null, '/nodes/' + i));
  if (!nodes.has(model.entry) || nodes.get(model.entry).children)
    issue('ENTRY_REQUIRED', model.entry, '/entry');
  const relationKeys = new Set();
  model.relations.forEach((edge, i) => {
    const path = '/relations/' + i;
    if (relationKeys.has(edge.key))
      issue('RELATION_KEY', edge.key, path + '/key');
    relationKeys.add(edge.key);
    for (const endpoint of ['from', 'to']) {
      if (!nodes.has(edge[endpoint]))
        issue('MISSING_NODE', edge.key, path + '/' + endpoint);
      else if (nodes.get(edge[endpoint]).children)
        issue('GROUP_ENDPOINT', edge.key, path + '/' + endpoint);
    }
    if (edge.from === edge.to) issue('SELF_RELATION', edge.key, path + '/to');
  });
  if (errors.length) return result;
  for (const node of nodes.values()) {
    if (!node.implemented) continue;
    if (
      [...nodes.values()].some(
        (part) => belongs(part.key, node.key, result) && !part.implemented,
      )
    )
      issue(
        'IMPLEMENTATION_PARTS',
        node.key,
        paths.get(node.key) + '/implemented',
      );
    const { incoming, outgoing, internal } = describe(model, result, node.key);
    if (
      [...incoming, ...outgoing, ...internal].some((edge) => !edge.implemented)
    )
      issue(
        'IMPLEMENTATION_RELATIONS',
        node.key,
        paths.get(node.key) + '/implemented',
      );
  }
  const neighbors = new Map(
    [...nodes.values()]
      .filter((n) => !n.children)
      .map((n) => [n.key, new Set()]),
  );
  for (const edge of model.relations) {
    neighbors.get(edge.from).add(edge.to);
    neighbors.get(edge.to).add(edge.from);
  }
  for (const [key, peers] of neighbors)
    if (!peers.size) issue('INTERACTION_REQUIRED', key, paths.get(key));
  const visited = new Set(),
    queue = [model.entry];
  while (queue.length) {
    const key = queue.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...neighbors.get(key));
  }
  for (const key of neighbors.keys())
    if (!visited.has(key))
      issue('DISCONNECTED_FROM_ENTRY', key, paths.get(key));
  for (const node of nodes.values())
    if (node.children) {
      const boundary = describe(model, result, node.key);
      if (!boundary.incoming.length && !boundary.outgoing.length)
        issue('UNCONNECTED_BOUNDARY', node.key, paths.get(node.key));
    }
  return result;
}

function belongs(key, owner, graph) {
  while (key !== null) {
    if (key === owner) return true;
    key = graph.parents.get(key);
  }
  return false;
}

function describe(model, graph, key) {
  const incoming = [],
    outgoing = [],
    internal = [];
  for (const edge of model.relations) {
    const from = belongs(edge.from, key, graph),
      to = belongs(edge.to, key, graph);
    if (from && to) internal.push(edge);
    else if (to) incoming.push(edge);
    else if (from) outgoing.push(edge);
  }
  return { incoming, outgoing, internal };
}

const RELATION_KINDS = ['data', 'command', 'state'];

// What an arrow states about the interactions it stands for. Every surface that
// hands a bundle to a panel builds it here, so a bundle of one from a card's list
// and a bundle of one on the map are the same object with the same fields.
function bundleFacts(from, to, relations, completion) {
  const kinds = RELATION_KINDS.filter((kind) =>
    relations.some((relation) => relation.kind === kind),
  );
  return {
    key: JSON.stringify([from, to]),
    from,
    to,
    relations,
    count: relations.length,
    kinds,
    kind: kinds.length === 1 ? kinds[0] : null,
    channels: [
      ...new Set(relations.map((relation) => relation.channel)),
    ].sort(),
    label: relations.length === 1 ? relations[0].label : null,
    implemented: relations.every((relation) => relation.implemented),
    state: aggregateImplementation(
      relations.map(
        (edge) =>
          completion?.[edge.key]?.state ||
          (edge.implemented ? 'confirmed' : 'unconfirmed'),
      ),
    ),
  };
}

/**
 * One interaction as an arrow of its own, for a panel opened from a list rather
 * than from the map. The reader asked about one exchange and is answered about
 * that exchange, in the shape every other arrow answers in.
 *
 * @param {any} relation
 * @param {Record<string, {state: string}>} [completion]
 */
export const relationBundle = (relation, completion) =>
  bundleFacts(relation.from, relation.to, [relation], completion);

function project(model, graph, expanded, completion, drawn) {
  if (graph.errors.length) throw new Error(graph.errors.join('\n'));
  const representative = (key) => {
    const chain = [];
    let current = key;
    while (current !== null) {
      chain.unshift(current);
      current = graph.parents.get(current);
    }
    return chain.find((candidate) => !expanded.has(candidate)) || key;
  };
  const bundles = new Map();
  for (const relation of model.relations) {
    if (drawn && !drawn.has(relation.key)) continue;
    const from = representative(relation.from),
      to = representative(relation.to);
    if (from === to) continue;
    const key = JSON.stringify([from, to]);
    if (!bundles.has(key)) bundles.set(key, { from, to, relations: [] });
    bundles.get(key).relations.push(relation);
  }
  return [...bundles.values()].map((bundle) =>
    bundleFacts(bundle.from, bundle.to, bundle.relations, completion),
  );
}

export const ArchitectureGraph = { validate, describe, project };
