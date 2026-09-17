import ELK from 'elkjs/lib/elk.bundled.js';
import { ArchitectureGraph } from '../model/graph.mjs';
import { digest } from '../model/digest.mjs';
import { createConnectors } from './connectors.mjs';

// Geometry depends only on the node tree and the relations, so an unchanged
// model is laid out once per session however often it is opened or remounted.
const computed = new Map();
const retained = 4;

// ELK lays out each containment level. Child layouts are scaled into stable
// parent rectangles; viewport changes never trigger another layout calculation.
export async function buildLayout(model, { signal, cached = true } = {}) {
  signal?.throwIfAborted();
  if (!cached) return layoutModel(model, signal);
  const key = digest({ nodes: model.nodes, relations: model.relations });
  const previous = computed.get(key);
  if (previous) return previous;
  const layout = await layoutModel(model, signal);
  // A withdrawn caller does not get a layout back, but the work is already done,
  // so it is kept for whoever asks for this model next.
  computed.set(key, layout);
  for (const stale of [...computed.keys()].slice(0, -retained))
    computed.delete(stale);
  signal?.throwIfAborted();
  return layout;
}

async function layoutModel(model, signal) {
  const graph = ArchitectureGraph.validate(model);
  if (graph.errors.length) throw new Error(graph.errors.join('\n'));
  const elk = new ELK();
  const local = new Map();
  const owners = [
    { key: null, children: model.nodes },
    ...[...graph.nodes.values()].filter((n) => n.children),
  ];
  for (const owner of owners) {
    signal?.throwIfAborted();
    const expanded = new Set();
    let current = owner.key;
    while (current !== null) {
      expanded.add(current);
      current = graph.parents.get(current);
    }
    const children = new Set(owner.children.map((n) => n.key));
    const bundles = ArchitectureGraph.project(model, graph, expanded).filter(
      (e) => children.has(e.from) && children.has(e.to),
    );
    const connected = bundles.length > 0;
    const result = await elk.layout({
      id: owner.key || 'architecture',
      layoutOptions: {
        'elk.algorithm': connected ? 'layered' : 'rectpacking',
        'elk.direction': 'RIGHT',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.aspectRatio': owner.key ? '1.4' : '1.6',
        'elk.spacing.nodeNode': owner.key ? '48' : '100',
        'elk.layered.spacing.nodeNodeBetweenLayers': owner.key ? '64' : '125',
        'elk.layered.wrapping.strategy': 'MULTI_EDGE',
        'elk.padding': '[top=20,left=20,bottom=20,right=20]',
        'elk.randomSeed': '42',
      },
      children: owner.children.map((n) => ({
        id: n.key,
        width: 440,
        height: 280,
      })),
      edges: bundles.map((bundle, i) => ({
        id: 'route-' + i,
        sources: [bundle.from],
        targets: [bundle.to],
      })),
    });
    signal?.throwIfAborted();
    local.set(owner.key, { result, bundles });
  }
  const nodes = {},
    routes = [];
  function place(owner, area, depth = 0, root = null) {
    const { result, bundles } = local.get(owner);
    const factor =
      owner === null
        ? 1
        : Math.min(area.width / result.width, area.height / result.height);
    const ox = area.x + (area.width - result.width * factor) / 2;
    const oy = area.y + (area.height - result.height * factor) / 2;
    for (const node of result.children) {
      const n = {
        key: node.id,
        parent: owner,
        root: root || node.id,
        depth: depth + 1,
        x: ox + node.x * factor,
        y: oy + node.y * factor,
        width: node.width * factor,
        height: node.height * factor,
      };
      nodes[node.id] = n;
      if (local.has(node.id)) {
        place(
          node.id,
          {
            x: n.x + n.width * 0.035,
            y: n.y + n.height * 0.19,
            width: n.width * 0.93,
            height: n.height * 0.765,
          },
          depth + 1,
          n.root,
        );
      }
    }
    for (let i = 0; i < bundles.length; i++) {
      const edge = result.edges[i],
        bundle = bundles[i];
      if (!edge.sections?.length)
        throw new Error('ELK did not route ' + edge.id);
      for (const section of edge.sections) {
        const points = [
          section.startPoint,
          ...(section.bendPoints || []),
          section.endPoint,
        ].map((p) => ({ x: ox + p.x * factor, y: oy + p.y * factor }));
        routes.push({
          owner,
          from: bundle.from,
          to: bundle.to,
          members: bundle.relations.map((e) => e.key),
          points,
        });
      }
    }
  }
  const outer = local.get(null).result;
  const bounds = { x: 0, y: 0, width: outer.width, height: outer.height };
  place(null, bounds);
  // Placing and connecting are the last stages after the ELK passes, so they are
  // the last point a withdrawn caller can be refused before the geometry is built.
  signal?.throwIfAborted();
  const connectors = createConnectors(model, graph, nodes, routes);
  return {
    engine: 'elkjs',
    version: '0.12.0',
    bounds,
    nodes,
    routes,
    connectors,
    layoutPasses: local.size,
  };
}

export function checkLayout(model, layout) {
  const graph = ArchitectureGraph.validate(model),
    errors = [];
  for (const [key] of graph.nodes) {
    const n = layout.nodes[key];
    if (
      !n ||
      !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(n[k])) ||
      n.width <= 0 ||
      n.height <= 0
    ) {
      errors.push('INVALID_GEOMETRY:' + key);
      continue;
    }
    if (n.parent) {
      const p = layout.nodes[n.parent];
      if (
        n.x < p.x ||
        n.y < p.y ||
        n.x + n.width > p.x + p.width + 0.001 ||
        n.y + n.height > p.y + p.height + 0.001
      )
        errors.push('OUTSIDE_PARENT:' + key);
    }
  }
  for (const edge of model.relations)
    if (!layout.routes.some((r) => r.members.includes(edge.key)))
      errors.push('UNROUTED_RELATION:' + edge.key);
  for (const route of layout.routes) {
    if (
      route.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      errors.push('INVALID_ROUTE');
  }
  return errors;
}
