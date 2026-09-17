import { ArchitectureGraph } from '../model/graph.mjs';
import { ArchitectureError } from '../model/errors.mjs';
import {
  assertArchitectureLimits,
  parseArchitecture,
  validateArchitecture,
} from '../model/parse.mjs';
import { analyzeProject } from '../model/project-analysis.mjs';
import { projectArchitecture } from '../model/project-architecture.mjs';
import {
  verifyProjectEvidence,
  relativeArtifactPath,
} from '../model/evidence.mjs';
import { legacyCompletion } from '../model/implementation.mjs';

// One load at a time per handle: starting another load on the same handle
// withdraws the one before it, so a slow answer can never land on top of a newer
// model. A handle is any key the caller keeps — the mounted map uses itself.
const current = new Map();

function withdrawable(handle, signal) {
  const controller = new AbortController();
  const follow = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', follow, { once: true });
  }
  if (handle !== undefined) {
    current
      .get(handle)
      ?.abort(new DOMException('LOAD_SUPERSEDED', 'AbortError'));
    current.set(handle, controller);
  }
  return {
    signal: controller.signal,
    done() {
      signal?.removeEventListener('abort', follow);
      if (current.get(handle) === controller) current.delete(handle);
    },
  };
}

// A withdrawal has to settle the promise the caller is holding. Racing it against
// the work means a response that never comes back — or comes back long after the
// caller moved on — cannot keep the promise pending or resolve over fresh state;
// the stages themselves stop at their next boundary.
async function untilWithdrawn(signal, work) {
  if (!signal) return work();
  let stop;
  const withdrawal = new Promise((resolve, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  try {
    return await Promise.race([(async () => work())(), withdrawal]);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

export async function readArchitecture(source, { signal } = {}) {
  signal?.throwIfAborted();
  return untilWithdrawn(signal, () => readSource(source, signal));
}

async function readSource(source, signal) {
  if (typeof source === 'string' || source instanceof URL) {
    let response;
    try {
      response = await fetch(source, { signal });
    } catch {
      signal?.throwIfAborted();
      throw new ArchitectureError('MODEL_LOAD_FAILED');
    }
    // A caller who withdrew is owed a cancellation, not a parse and not a load
    // failure invented from the status of a response nobody will read.
    signal?.throwIfAborted();
    if (!response.ok)
      throw new ArchitectureError('MODEL_LOAD_FAILED', [
        String(response.status),
      ]);
    const text = await response.text();
    signal?.throwIfAborted();
    return parseArchitecture(text, { signal });
  }
  if (source instanceof Blob) {
    const text = await source.text();
    signal?.throwIfAborted();
    return parseArchitecture(text, { signal });
  }
  let model;
  try {
    model = structuredClone(source);
  } catch {
    throw new ArchitectureError('INVALID_MODEL');
  }
  signal?.throwIfAborted();
  // A model handed over as an object skips the text bound but faces the same
  // shape bounds, and faces them before the contract walk.
  assertArchitectureLimits(model);
  const graph = validateArchitecture(model);
  if (!graph.valid)
    throw new ArchitectureError(
      'INVALID_MODEL',
      graph.errors,
      graph.diagnostics,
    );
  return model;
}

const resourceURLs = {
  strings: new URL('../../assets/archivarius-strings.json', import.meta.url),
  contracts: new URL(
    '../../assets/archivarius-contracts.json',
    import.meta.url,
  ),
  project: new URL(
    '../../assets/archivarius-project-strings.json',
    import.meta.url,
  ),
};

export async function readResources({ assetsBaseUrl, signal } = {}) {
  signal?.throwIfAborted();
  return untilWithdrawn(signal, () => readAssets(assetsBaseUrl, signal));
}

async function readAssets(assetsBaseUrl, signal) {
  const names = ['strings', 'contracts', 'project'];
  const files = [
    'archivarius-strings.json',
    'archivarius-contracts.json',
    'archivarius-project-strings.json',
  ];
  const [copy, contracts, projectCopy] = await Promise.all(
    names.map(async (name, i) => {
      const url = assetsBaseUrl
        ? new URL(files[i], new URL(assetsBaseUrl, document.baseURI))
        : resourceURLs[name];
      let response;
      try {
        response = await fetch(url, { signal });
      } catch {
        signal?.throwIfAborted();
        throw new ArchitectureError('RESOURCES_LOAD_FAILED');
      }
      signal?.throwIfAborted();
      if (!response.ok) throw new ArchitectureError('RESOURCES_LOAD_FAILED');
      const asset = await response.json();
      signal?.throwIfAborted();
      return asset;
    }),
  );
  return { copy, contracts, projectCopy };
}

export async function prepareArchitecture(source, { signal, handle } = {}) {
  const load = withdrawable(handle, signal);
  try {
    return await untilWithdrawn(load.signal, () =>
      prepare(source, load.signal),
    );
  } finally {
    load.done();
  }
}

async function prepare(source, signal) {
  const input = await readArchitecture(source, { signal });
  signal?.throwIfAborted();
  const project = input.version === 4 ? input : null;
  const model = project ? projectArchitecture(project) : input;
  // The projected graph is what the layout has to draw, so it faces the stated
  // bounds too, before any geometry is computed.
  if (project) assertArchitectureLimits(model);
  let evidence = { verifiedResults: [], diagnostics: [] };
  if (project && (typeof source === 'string' || source instanceof URL)) {
    const base = new URL(source, globalThis.document?.baseURI);
    evidence = await verifyProjectEvidence(project, async (path) => {
      // Verification reads one artifact per receipt; a withdrawn caller stops
      // that queue instead of paying for every remaining request.
      signal?.throwIfAborted();
      if (!relativeArtifactPath(path)) throw new Error('ARTIFACT_PATH');
      const url = new URL(path, base);
      if (url.origin !== base.origin) throw new Error('ARTIFACT_PATH');
      const response = await fetch(url, { signal });
      signal?.throwIfAborted();
      if (!response.ok) throw new Error('EVIDENCE_UNAVAILABLE');
      return new Uint8Array(await response.arrayBuffer());
    });
  }
  signal?.throwIfAborted();
  const analysis = project ? analyzeProject(project, evidence) : null;
  if (project && !model.nodes.length)
    return {
      model,
      input,
      project,
      analysis,
      completion: {
        nodes: analysis.completion,
        relations: analysis.completion,
      },
      evidence,
      graph: {
        nodes: new Map(),
        parents: new Map(),
        errors: [],
        diagnostics: [],
      },
      layout: {
        nodes: {},
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        layoutPasses: 0,
      },
    };
  signal?.throwIfAborted();
  const { buildLayout, checkLayout } = await import('../layout/layout.mjs');
  const layout = await buildLayout(model, { signal });
  signal?.throwIfAborted();
  const errors = checkLayout(model, layout);
  if (errors.length) throw new ArchitectureError('INVALID_LAYOUT', errors);
  const graph = ArchitectureGraph.validate(model);
  if (project) {
    for (const node of graph.nodes.values())
      node.implemented = analysis.completion[node.key].implemented;
    for (const edge of model.relations)
      edge.implemented = analysis.completion[edge.key].implemented;
  }
  return {
    model,
    input,
    project,
    analysis,
    completion: analysis
      ? { nodes: analysis.completion, relations: analysis.completion }
      : legacyCompletion(model, graph),
    evidence,
    graph,
    layout,
  };
}
