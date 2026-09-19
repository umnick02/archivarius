import { Position } from '@xyflow/react';
import { ArchitectureGraph } from '../model/graph.mjs';
import { rootTones } from '../model/appearance.mjs';
import { expansionAt } from '../model/zoom.mjs';

// The palette is the model's display vocabulary; this surface only decides the
// pixels it is drawn with. Dash lengths belong here, tones never do.
export const colors = rootTones;
export const lineDashes = {
  solid: null,
  thick: [7, 5],
  dotted: [2, 4],
  bundled: [11, 4, 3, 4],
};
// The silhouette of a shape in this surface's pixels: a barrel for a store, a
// pill for an outside participant, a softly rounded card for everything else.
export const shapeRadii = {
  box: (w) => Math.min(14, w * 0.035) + 'px',
  cylinder: (w, h) => w / 2 + 'px / ' + Math.min(22, h * 0.16) + 'px',
  stadium: (w, h) => h / 2 + 'px',
};

// The sizes a card draws its words at. The numbers are the card's geometry — a
// title is measured against the box it has to fit — but the unit is the reader's:
// every one is stated in rem, so a doubled text setting doubles the card's text
// while the arithmetic stays the one the layout asked for. `box` is the card in
// screen pixels (its layout size times the camera's zoom).
const rem = (px) => px / 16 + 'rem';
export function cardMetrics(box, expanded) {
  const w = box.width,
    h = box.height;
  return {
    pad: rem(Math.min(22, w * 0.065)),
    title: rem(
      expanded
        ? Math.min(17, Math.max(11, h * 0.055))
        : Math.min(box.depth === 1 ? 21 : 18, Math.max(9, w / 12)),
    ),
    small: rem(10),
    body: rem(13),
    gap: rem(10),
    mark: rem(Math.min(18, Math.max(8, w * 0.1), h * 0.3)),
  };
}

export function groupInteractions(edges, incoming = false) {
  const groups = new Map();
  for (const edge of edges) {
    const peer = incoming ? edge.from : edge.to;
    const key = JSON.stringify([
      incoming,
      peer,
      edge.label,
      edge.kind,
      edge.channel,
    ]);
    if (!groups.has(key))
      groups.set(key, { key, peer, label: edge.label, relations: [] });
    groups.get(key).relations.push(edge);
  }
  return [...groups.values()];
}

export function edgeImplementationPoint(edge, zoom) {
  const size = Math.min(12, Math.max(6, edge.targetWidth * zoom * 0.06));
  const [dx, dy] = {
    left: [-1, 0],
    right: [1, 0],
    top: [0, -1],
    bottom: [0, 1],
  }[edge.target.position];
  return {
    x: edge.target.x + (dx * (7 + size / 2)) / zoom,
    y: edge.target.y + (dy * (7 + size / 2)) / zoom,
    size,
  };
}

// Which containers a scale has opened is a decision about abstraction, so it is
// made in `model/zoom.mjs`; this surface only passes on the scale it is drawn at.
export function expandedAt(layout, zoom, size, previous = new Set()) {
  return expansionAt({ layout, zoom, size, previous });
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

export function projectedEdges(
  model,
  graph,
  layout,
  expanded,
  completion,
  drawn,
) {
  const projected = ArchitectureGraph.project(
    model,
    graph,
    expanded,
    completion,
    drawn,
  );
  return projected.map((bundle) => {
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
    return {
      id,
      bundle,
      paths,
      source,
      target,
      targetWidth: layout.nodes[bundle.to].width,
      label,
      labelCandidates,
      owner,
    };
  });
}

// Labels are placed for the arrows the view actually draws. A layer is a
// projection now, not a tint, so an off-layer arrow never reaches this far and
// there is nothing here to hide.
export function placeEdgeLabels(edges, nodes, viewport, size, label) {
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
  for (const edge of edges) {
    const point = edgeImplementationPoint(edge, zoom);
    obstacles.push({
      x: point.x * zoom + x - point.size / 2 - 2,
      y: point.y * zoom + y - point.size / 2 - 2,
      width: point.size + 4,
      height: point.size + 4,
    });
  }
  const overlaps = (a, b) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
  return edges.map((edge) => {
    // The box is reserved for the words the arrow actually draws, so a label is
    // never placed where its own text will not fit.
    for (const labelText of new Set([
      label(edge.bundle),
      label(edge.bundle, true),
    ])) {
      const width = labelText.length * 5.7 + 18,
        height = 25;
      // A short label can sit just above or beside its stroke when the marker
      // occupies its midpoint. Every alternative still clears cards and labels.
      const candidates = edge.labelCandidates.flatMap((point) => [
        point,
        { ...point, y: point.y - 18 / zoom },
        { ...point, y: point.y + 18 / zoom },
      ]);
      for (const candidate of candidates) {
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
        return { ...edge, label: candidate, labelText, labelVisible: true };
      }
    }
    return { ...edge, labelVisible: false };
  });
}
