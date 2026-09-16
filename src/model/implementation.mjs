export function aggregateImplementation(states) {
  return states.length && states.every((state) => state === 'confirmed')
    ? 'confirmed'
    : states.some((state) => state !== 'unconfirmed')
      ? 'partial'
      : 'unconfirmed';
}

export function legacyCompletion(model, graph) {
  const relations = Object.fromEntries(
    model.relations.map((edge) => [
      edge.key,
      {
        state: edge.implemented ? 'confirmed' : 'unconfirmed',
      },
    ]),
  );
  const nodes = {};
  const visit = (node) => {
    node.children?.forEach(visit);
    const related = model.relations.filter(
      (edge) => edge.from === node.key || edge.to === node.key,
    );
    const states = [
      ...(node.children || []).map((child) => nodes[child.key].state),
      ...related.map((edge) => relations[edge.key].state),
    ];
    nodes[node.key] = {
      state: node.implemented
        ? 'confirmed'
        : states.some((state) => state !== 'unconfirmed')
          ? 'partial'
          : 'unconfirmed',
    };
  };
  for (const node of graph.nodes.values())
    if (graph.parents.get(node.key) === null) visit(node);
  return { nodes, relations };
}
