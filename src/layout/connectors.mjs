const inside = (p, r) =>
  p.x > r.x + 1e-7 &&
  p.x < r.x + r.width - 1e-7 &&
  p.y > r.y + 1e-7 &&
  p.y < r.y + r.height - 1e-7;

function intersects(a, b, r) {
  if (Math.abs(a.x - b.x) < 1e-7)
    return (
      a.x > r.x + 1e-7 &&
      a.x < r.x + r.width - 1e-7 &&
      Math.max(a.y, b.y) > r.y + 1e-7 &&
      Math.min(a.y, b.y) < r.y + r.height - 1e-7
    );
  return (
    a.y > r.y + 1e-7 &&
    a.y < r.y + r.height - 1e-7 &&
    Math.max(a.x, b.x) > r.x + 1e-7 &&
    Math.min(a.x, b.x) < r.x + r.width - 1e-7
  );
}

// Connect ELK's boundary port to a descendant through the free corridors of
// that region. This runs at build time; it never changes sibling placement.
function connect(start, end, region, obstacles) {
  const xs = new Set([start.x, end.x, region.x, region.x + region.width]);
  const ys = new Set([start.y, end.y, region.y, region.y + region.height]);
  for (const r of obstacles) {
    xs.add(r.x);
    xs.add(r.x + r.width);
    ys.add(r.y);
    ys.add(r.y + r.height);
  }
  const x = [...xs]
    .filter((v) => v >= region.x - 1e-7 && v <= region.x + region.width + 1e-7)
    .sort((a, b) => a - b);
  const y = [...ys]
    .filter((v) => v >= region.y - 1e-7 && v <= region.y + region.height + 1e-7)
    .sort((a, b) => a - b);
  const point = (id) => ({
    x: x[id % x.length],
    y: y[Math.floor(id / x.length)],
  });
  const source = y.indexOf(start.y) * x.length + x.indexOf(start.x),
    target = y.indexOf(end.y) * x.length + x.indexOf(end.x);
  const costs = new Map([[source, 0]]),
    previous = new Map(),
    open = new Set([source]),
    closed = new Set();
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  while (open.size) {
    let id,
      best = Infinity;
    for (const candidate of open) {
      const score = costs.get(candidate) + distance(point(candidate), end);
      if (score < best) {
        best = score;
        id = candidate;
      }
    }
    if (id === target) {
      const path = [point(id)];
      while (previous.has(id)) {
        id = previous.get(id);
        path.unshift(point(id));
      }
      return path.filter(
        (p, i) =>
          !i ||
          i === path.length - 1 ||
          (Math.abs(path[i - 1].x - path[i + 1].x) > 1e-7 &&
            Math.abs(path[i - 1].y - path[i + 1].y) > 1e-7),
      );
    }
    open.delete(id);
    closed.add(id);
    const ix = id % x.length,
      iy = Math.floor(id / x.length),
      a = point(id);
    for (const [nx, ny] of [
      [ix - 1, iy],
      [ix + 1, iy],
      [ix, iy - 1],
      [ix, iy + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= x.length || ny >= y.length) continue;
      const next = ny * x.length + nx,
        b = point(next);
      if (
        closed.has(next) ||
        obstacles.some((r) => inside(b, r) || intersects(a, b, r))
      )
        continue;
      const cost = costs.get(id) + distance(a, b);
      if (cost < (costs.get(next) ?? Infinity)) {
        costs.set(next, cost);
        previous.set(next, id);
        open.add(next);
      }
    }
  }
  throw new Error('CONNECTOR_ROUTE_MISSING');
}

export function createConnectors(model, graph, nodes, routes) {
  const connectors = {};
  for (const route of routes)
    for (const key of route.members) {
      const relation = model.relations.find((r) => r.key === key);
      for (const side of ['from', 'to']) {
        let key = relation[side];
        const branch = route[side],
          port = side === 'from' ? route.points[0] : route.points.at(-1);
        while (key !== branch) {
          const id = [route.owner, branch, key, port.x, port.y].join('/');
          if (!connectors[id]) {
            const n = nodes[key],
              cx = n.x + n.width / 2,
              cy = n.y + n.height / 2;
            const dx = port.x - cx,
              dy = port.y - cy,
              scale =
                1 /
                Math.max(
                  Math.abs(dx) / (n.width / 2),
                  Math.abs(dy) / (n.height / 2),
                );
            const endpoint = {
              x: cx + dx * scale,
              y: cy + dy * scale,
              position:
                Math.abs(dx) / n.width > Math.abs(dy) / n.height
                  ? dx > 0
                    ? 'right'
                    : 'left'
                  : dy > 0
                    ? 'bottom'
                    : 'top',
            };
            const obstacles = [n];
            let current = key;
            while (current !== branch) {
              const parent = graph.parents.get(current);
              for (const sibling of Object.values(nodes).filter(
                (s) => s.parent === parent && s.key !== current,
              )) {
                const padding = Math.min(sibling.width, sibling.height) * 0.035;
                obstacles.push({
                  x: sibling.x - padding,
                  y: sibling.y - padding,
                  width: sibling.width + 2 * padding,
                  height: sibling.height + 2 * padding,
                });
              }
              current = parent;
            }
            connectors[id] = {
              endpoint,
              points: connect(endpoint, port, nodes[branch], obstacles),
            };
          }
          key = graph.parents.get(key);
        }
      }
    }
  return connectors;
}
