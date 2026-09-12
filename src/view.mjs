import { Position } from '@xyflow/react';
import { ArchitectureGraph } from './graph.mjs';

export const colors = [
  '#5779a6',
  '#77679c',
  '#b07852',
  '#558574',
  '#b58b37',
  '#617b82',
  '#74747e',
];
export const kindColors = {
  data: '#537e68',
  command: '#8b6ead',
  state: '#5d8796',
};

export function expandedAt(layout, zoom, size, previous = new Set()) {
  const expanded = new Set();
  for (const n of Object.values(layout.nodes)) {
    if (!Object.values(layout.nodes).some((child) => child.parent === n.key))
      continue;
    const factor = previous.has(n.key) ? 0.9 : 1;
    const width = Math.max(
      160,
      Math.min(
        560,
        size.width * 0.75,
        ((size.height - 170) * 0.8 * n.width) / n.height,
      ),
    );
    const height = Math.min(320, (width * n.height) / n.width);
    if (n.width * zoom >= width * factor && n.height * zoom >= height * factor)
      expanded.add(n.key);
  }
  return expanded;
}

export function isVisible(key, graph, expanded) {
  let parent = graph.parents.get(key);
  while (parent !== null) {
    if (!expanded.has(parent)) return false;
    parent = graph.parents.get(parent);
  }
  return true;
}

const opposite = {
  left: Position.Right,
  right: Position.Left,
  top: Position.Bottom,
  bottom: Position.Top,
};
function direction(a, b) {
  if (Math.abs(b.x - a.x) > Math.abs(b.y - a.y))
    return b.x > a.x ? Position.Right : Position.Left;
  return b.y > a.y ? Position.Bottom : Position.Top;
}
const pathFor = (points) =>
  points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
function commonParent(a, b, graph) {
  const chain = new Set();
  let p = graph.parents.get(a);
  while (p !== null) {
    chain.add(p);
    p = graph.parents.get(p);
  }
  p = graph.parents.get(b);
  while (p !== null) {
    if (chain.has(p)) return p;
    p = graph.parents.get(p);
  }
  return null;
}

export function projectedEdges(model, graph, layout, expanded) {
  return ArchitectureGraph.project(model, graph, expanded).map((bundle) => {
    const owner = commonParent(bundle.from, bundle.to, graph);
    const route = layout.routes.find(
      (r) => r.owner === owner && r.members.includes(bundle.relations[0].key),
    );
    if (!route) throw new Error('ELK_ROUTE_MISSING:' + bundle.relations[0].key);
    const first = route.points[0],
      last = route.points.at(-1);
    const startDirection = direction(first, route.points[1]),
      endDirection = direction(route.points.at(-2), last);
    const prefix =
      bundle.from !== route.from &&
      layout.connectors[
        [owner, route.from, bundle.from, first.x, first.y].join('/')
      ];
    const suffix =
      bundle.to !== route.to &&
      layout.connectors[[owner, route.to, bundle.to, last.x, last.y].join('/')];
    if (
      (bundle.from !== route.from && !prefix) ||
      (bundle.to !== route.to && !suffix)
    )
      throw new Error('CONNECTOR_MISSING');
    const source = prefix
      ? prefix.endpoint
      : { ...first, position: startDirection };
    const target = suffix
      ? suffix.endpoint
      : { ...last, position: opposite[endDirection] };
    const paths = [];
    const pointSets = [];
    if (prefix) paths.push(pathFor(prefix.points));
    if (prefix) pointSets.push(prefix.points);
    paths.push(pathFor(route.points));
    pointSets.push(route.points);
    if (suffix) paths.push(pathFor([...suffix.points].reverse()));
    if (suffix) pointSets.push(suffix.points);
    let longest = 0,
      label = first;
    for (let i = 1; i < route.points.length; i++) {
      const p = route.points[i - 1],
        q = route.points[i],
        distance = Math.hypot(q.x - p.x, q.y - p.y);
      if (distance > longest) {
        longest = distance;
        label = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      }
    }
    const id =
      bundle.relations.map((r) => r.key).join('--') +
      '--' +
      bundle.from +
      '--' +
      bundle.to;
    const labelCandidates = pointSets.flatMap((points) =>
      points.slice(1).flatMap((b, i) => {
        const a = points[i],
          span = Math.hypot(b.x - a.x, b.y - a.y);
        return [0.5, 0.3, 0.7].map((t) => ({
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          span,
        }));
      }),
    );
    return { id, bundle, paths, source, target, label, labelCandidates, owner };
  });
}

export function placeEdgeLabels(edges, nodes, viewport, size, layer) {
  const { x, y, zoom } = viewport;
  const obstacles = nodes
    .filter((n) => !n.hidden)
    .map((n) => ({
      x: n.data.box.x * zoom + x - 5,
      y: n.data.box.y * zoom + y - 5,
      width: n.width * zoom + 10,
      height: (n.data.expanded ? n.height * 0.17 : n.height) * zoom + 10,
    }));
  const labels = [];
  const overlaps = (a, b) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
  return edges.map((edge) => {
    if (layer !== 'all' && edge.bundle.kind !== layer)
      return { ...edge, labelVisible: false };
    const width =
        edge.bundle.label.length * 5.7 +
        18 +
        (edge.bundle.relations.length > 1 ? 20 : 0),
      height = 25;
    for (const candidate of edge.labelCandidates) {
      if (candidate.span * zoom < 65) continue;
      const box = {
        x: candidate.x * zoom + x - width / 2,
        y: candidate.y * zoom + y - height / 2,
        width,
        height,
      };
      if (
        box.x < 12 ||
        box.y < 66 ||
        box.x + width > size.width - 12 ||
        box.y + height > size.height - 100
      )
        continue;
      if (
        obstacles.some((n) => overlaps(box, n)) ||
        labels.some((n) => overlaps(box, n))
      )
        continue;
      labels.push(box);
      return { ...edge, label: candidate, labelVisible: true };
    }
    return { ...edge, labelVisible: false };
  });
}
