import { ArchitectureGraph } from './graph.mjs';
import {
  ArchitectureError,
  parseArchitecture,
  validateArchitecture,
} from './core.mjs';
import { analyzeProject, projectArchitecture } from './project.mjs';
import { verifyProjectEvidence, relativeArtifactPath } from './evidence.mjs';
import { legacyCompletion } from './implementation.mjs';

export async function readArchitecture(source, { signal } = {}) {
  signal?.throwIfAborted();
  if (typeof source === 'string' || source instanceof URL) {
    let response;
    try {
      response = await fetch(source, { signal });
    } catch (error) {
      signal?.throwIfAborted();
      throw new ArchitectureError('MODEL_LOAD_FAILED');
    }
    if (!response.ok)
      throw new ArchitectureError('MODEL_LOAD_FAILED', [
        String(response.status),
      ]);
    return parseArchitecture(await response.text());
  }
  if (source instanceof Blob) return parseArchitecture(await source.text());
  let model;
  try {
    model = structuredClone(source);
  } catch {
    throw new ArchitectureError('INVALID_MODEL');
  }
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
  ru: new URL('../assets/ru.json', import.meta.url),
  en: new URL('../assets/en.json', import.meta.url),
  contracts: new URL('../assets/contracts.json', import.meta.url),
  contractsEn: new URL('../assets/contracts.en.json', import.meta.url),
  projectRu: new URL('../assets/project.ru.json', import.meta.url),
  projectEn: new URL('../assets/project.en.json', import.meta.url),
};

export async function readResources({
  locale = 'ru',
  assetsBaseUrl,
  signal,
} = {}) {
  if (!['ru', 'en'].includes(locale))
    throw new ArchitectureError('UNSUPPORTED_LOCALE');
  const names = [
    locale,
    locale === 'en' ? 'contractsEn' : 'contracts',
    locale === 'en' ? 'projectEn' : 'projectRu',
  ];
  const files = [
    locale + '.json',
    locale === 'en' ? 'contracts.en.json' : 'contracts.json',
    'project.' + locale + '.json',
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
      if (!response.ok) throw new ArchitectureError('RESOURCES_LOAD_FAILED');
      return response.json();
    }),
  );
  return { copy, contracts, projectCopy };
}

export async function prepareArchitecture(source, { signal } = {}) {
  const input = await readArchitecture(source, { signal });
  signal?.throwIfAborted();
  const project = input.version === 4 ? input : null;
  const model = project ? projectArchitecture(project) : input;
  let evidence = { verifiedResults: [], diagnostics: [] };
  if (project && (typeof source === 'string' || source instanceof URL)) {
    const base = new URL(source, globalThis.document?.baseURI);
    evidence = await verifyProjectEvidence(project, async (path) => {
      if (!relativeArtifactPath(path)) throw new Error('ARTIFACT_PATH');
      const url = new URL(path, base);
      if (url.origin !== base.origin) throw new Error('ARTIFACT_PATH');
      const response = await fetch(url, { signal });
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
  const { buildLayout, checkLayout } = await import('./layout/layout.mjs');
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
