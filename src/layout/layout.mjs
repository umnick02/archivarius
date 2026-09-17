import { ArchitectureGraph } from '../model/graph.mjs';
import { digest } from '../model/digest.mjs';
import { layoutModel } from './geometry.mjs';

// Geometry depends only on the node tree and the relations, so an unchanged
// model is laid out once per session however often it is opened or remounted.
const computed = new Map();
const retained = 4;

// A layout is seconds of arithmetic, so it runs in a worker and the page stays
// answerable while it does. A host without workers, or one whose policy refuses
// them, gets the same geometry on the main thread instead of no map.
export async function buildLayout(model, { signal, cached = true } = {}) {
  signal?.throwIfAborted();
  if (!cached) return computeLayout(model, signal);
  const key = digest({ nodes: model.nodes, relations: model.relations });
  const previous = computed.get(key);
  if (previous) return previous;
  const layout = await computeLayout(model, signal);
  // A withdrawn layout is a stopped worker with nothing to show, so only a
  // finished one is kept — the geometry already cached stays the last good one.
  signal?.throwIfAborted();
  computed.set(key, layout);
  for (const stale of [...computed.keys()].slice(0, -retained))
    computed.delete(stale);
  return layout;
}

async function computeLayout(model, signal) {
  const offThread = await inWorker(model, signal);
  return offThread ?? layoutModel(model, signal);
}

// Resolves with the geometry, or with null when this host cannot use a worker at
// all — the caller then lays the same model out itself. A worker that answers
// with a failure is reporting the model, not the platform, so that one throws.
async function inWorker(model, signal) {
  if (typeof Worker !== 'function') return null;
  let worker;
  try {
    worker = new Worker(new URL('./layout-worker.mjs', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
  try {
    return await new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      });
      worker.addEventListener('message', ({ data }) =>
        data.ok ? resolve(data.layout) : reject(new Error(data.message)),
      );
      // A worker that dies mid-layout — memory, a blocked import — is a lost
      // thread, not a lost map.
      worker.addEventListener('error', () => resolve(null));
      worker.addEventListener('messageerror', () => resolve(null));
      worker.postMessage({ model });
    });
  } finally {
    worker.terminate();
  }
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
