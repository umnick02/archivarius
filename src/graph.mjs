const relationKinds = ['data', 'command', 'state'];
const nodeKinds = ['subsystem', 'component', 'store', 'external'];
const zones = [
  'presentation',
  'application',
  'infrastructure',
  'pure',
  'external',
];
const validText = (value) =>
  typeof value === 'string' && value.trim().length > 0;
const validKey = (value) => validText(value) && /^[a-z][a-z0-9-]*$/.test(value);
const record = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function validate(model) {
  const errors = [],
    nodes = new Map(),
    parents = new Map();
  const result = { errors, nodes, parents };
  if (!record(model)) {
    errors.push('INVALID_MODEL');
    return result;
  }
  function fields(item, allowed, key = 'model') {
    for (const name of Object.keys(item))
      if (!allowed.includes(name))
        errors.push('UNKNOWN_FIELD:' + key + '.' + name);
  }
  fields(model, [
    '$schema',
    'version',
    'scope',
    'entry',
    'title',
    'nodes',
    'relations',
  ]);
  if (model.title !== undefined && !validText(model.title))
    errors.push('MODEL_TITLE');
  if (model.$schema !== undefined && !validText(model.$schema))
    errors.push('MODEL_SCHEMA');
  if (model.version !== 3) errors.push('MODEL_VERSION');
  if (model.scope !== 'target') errors.push('MODEL_SCOPE');
  if (!Array.isArray(model.nodes) || !model.nodes.length)
    errors.push('NODES_REQUIRED');
  const active = new Set();
  function checkImplementation(item) {
    if (
      item.implementationEvidence !== undefined &&
      !validText(item.implementationEvidence)
    )
      errors.push('IMPLEMENTATION_EVIDENCE_FORMAT:' + item.key);
    if (typeof item.implemented !== 'boolean')
      errors.push('IMPLEMENTATION_REQUIRED:' + item.key);
    if (item.implemented === true && !validText(item.implementationEvidence))
      errors.push('IMPLEMENTATION_EVIDENCE:' + item.key);
  }
  function walk(node, parent) {
    if (!record(node)) {
      errors.push('INVALID_NODE');
      return;
    }
    if (active.has(node)) {
      errors.push('CONTAINMENT_CYCLE');
      return;
    }
    if (!validKey(node.key)) errors.push('INVALID_KEY');
    if (nodes.has(node.key)) {
      errors.push('DUPLICATE_NODE:' + node.key);
      return;
    }
    nodes.set(node.key, node);
    fields(
      node,
      [
        'key',
        'title',
        'summary',
        'kind',
        'zone',
        'rules',
        'example',
        'detail',
        'detailNote',
        'children',
        'implemented',
        'implementationEvidence',
      ],
      node.key,
    );
    parents.set(node.key, parent);
    checkImplementation(node);
    if (!validText(node.title) || !validText(node.summary))
      errors.push('NODE_RESPONSIBILITY:' + node.key);
    if (!nodeKinds.includes(node.kind)) errors.push('NODE_KIND:' + node.key);
    if (!zones.includes(node.zone)) errors.push('NODE_ZONE:' + node.key);
    if (
      !Array.isArray(node.rules) ||
      node.rules.some(
        (rule) =>
          !record(rule) || !validText(rule.title) || !validText(rule.text),
      )
    )
      errors.push('NODE_RULES:' + node.key);
    if (Array.isArray(node.rules))
      for (const rule of node.rules)
        if (record(rule)) fields(rule, ['title', 'text'], node.key);
    if (node.example !== undefined && !validText(node.example))
      errors.push('NODE_EXAMPLE:' + node.key);
    if (!['mapped', 'boundary'].includes(node.detail))
      errors.push('NODE_DETAIL:' + node.key);
    if (
      node.detail === 'mapped' &&
      (!Array.isArray(node.children) || !node.children.length)
    )
      errors.push('PARTS_REQUIRED:' + node.key);
    if (node.detail === 'mapped' && node.kind !== 'subsystem')
      errors.push('CONTAINER_KIND:' + node.key);
    if (node.detail !== 'mapped' && node.children !== undefined)
      errors.push('CONTRADICTORY_DETAIL:' + node.key);
    if (
      (node.detail === 'boundary' || node.detailNote !== undefined) &&
      !validText(node.detailNote)
    )
      errors.push('BOUNDARY_REASON:' + node.key);
    active.add(node);
    if (Array.isArray(node.children))
      for (const child of node.children) walk(child, node.key);
    active.delete(node);
  }
  for (const node of Array.isArray(model.nodes) ? model.nodes : [])
    walk(node, null);
  if (!nodes.has(model.entry) || nodes.get(model.entry)?.children)
    errors.push('ENTRY_REQUIRED');
  const relationKeys = new Set();
  if (!Array.isArray(model.relations)) errors.push('RELATIONS_REQUIRED');
  for (const edge of Array.isArray(model.relations) ? model.relations : []) {
    if (!record(edge)) {
      errors.push('INVALID_RELATION');
      continue;
    }
    if (!validKey(edge.key) || relationKeys.has(edge.key))
      errors.push('RELATION_KEY');
    relationKeys.add(edge.key);
    fields(
      edge,
      [
        'key',
        'from',
        'to',
        'kind',
        'channel',
        'label',
        'payload',
        'meaning',
        'implemented',
        'implementationEvidence',
      ],
      edge.key,
    );
    checkImplementation(edge);
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      errors.push('MISSING_NODE:' + edge.key);
    if (edge.from === edge.to) errors.push('SELF_RELATION:' + edge.key);
    if (!validKey(edge.channel)) errors.push('RELATION_CHANNEL:' + edge.key);
    if (!relationKinds.includes(edge.kind))
      errors.push('RELATION_KIND:' + edge.key);
    if (!validText(edge.label) || !validText(edge.meaning))
      errors.push('RELATION_MEANING:' + edge.key);
    if (!validText(edge.payload)) errors.push('RELATION_PAYLOAD:' + edge.key);
    if (nodes.get(edge.from)?.children || nodes.get(edge.to)?.children)
      errors.push('GROUP_ENDPOINT:' + edge.key);
  }
  // An unconnected component is rejected, not relabelled as unexplored.
  if (errors.length) return result;
  for (const node of nodes.values()) {
    if (!node.implemented) continue;
    if (
      [...nodes.values()].some(
        (part) => belongs(part.key, node.key, result) && !part.implemented,
      )
    )
      errors.push('IMPLEMENTATION_PARTS:' + node.key);
    const { incoming, outgoing, internal } = describe(model, result, node.key);
    if (
      [...incoming, ...outgoing, ...internal].some((edge) => !edge.implemented)
    )
      errors.push('IMPLEMENTATION_RELATIONS:' + node.key);
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
    if (!peers.size) errors.push('INTERACTION_REQUIRED:' + key);
  const visited = new Set(),
    queue = [model.entry];
  while (queue.length) {
    const key = queue.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(...neighbors.get(key));
  }
  for (const key of neighbors.keys())
    if (!visited.has(key)) errors.push('DISCONNECTED_FROM_ENTRY:' + key);
  for (const node of nodes.values())
    if (node.children) {
      const boundary = describe(model, result, node.key);
      if (!boundary.incoming.length && !boundary.outgoing.length)
        errors.push('UNCONNECTED_BOUNDARY:' + node.key);
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

function project(model, graph, expanded) {
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
    const from = representative(relation.from),
      to = representative(relation.to);
    if (from === to) continue;
    const key = JSON.stringify([
      from,
      to,
      relation.kind,
      relation.channel,
      relation.label,
    ]);
    if (!bundles.has(key))
      bundles.set(key, {
        key,
        from,
        to,
        kind: relation.kind,
        label: relation.label,
        implemented: true,
        relations: [],
      });
    bundles.get(key).relations.push(relation);
    bundles.get(key).implemented &&= relation.implemented;
  }
  return [...bundles.values()];
}

export const ArchitectureGraph = { validate, describe, project };
