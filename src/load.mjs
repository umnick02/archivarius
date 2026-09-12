import { ArchitectureGraph } from './graph.mjs';
import { ArchitectureError, parseArchitecture } from './core.mjs';

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
  const graph = ArchitectureGraph.validate(model);
  if (graph.errors.length)
    throw new ArchitectureError('INVALID_MODEL', graph.errors);
  return model;
}

const resourceURLs = {
  ru: new URL('../assets/ru.json', import.meta.url),
  en: new URL('../assets/en.json', import.meta.url),
  contracts: new URL('../assets/contracts.json', import.meta.url),
  contractsEn: new URL('../assets/contracts.en.json', import.meta.url),
};

export async function readResources({
  locale = 'ru',
  assetsBaseUrl,
  signal,
} = {}) {
  if (!['ru', 'en'].includes(locale))
    throw new ArchitectureError('UNSUPPORTED_LOCALE');
  const names = [locale, locale === 'en' ? 'contractsEn' : 'contracts'];
  const files = [
    locale + '.json',
    locale === 'en' ? 'contracts.en.json' : 'contracts.json',
  ];
  const [copy, contracts] = await Promise.all(
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
  return { copy, contracts };
}

export async function prepareArchitecture(source, { signal } = {}) {
  const model = await readArchitecture(source, { signal });
  signal?.throwIfAborted();
  const { buildLayout, checkLayout } = await import('./layout/layout.mjs');
  const layout = await buildLayout(model, { signal });
  signal?.throwIfAborted();
  const errors = checkLayout(model, layout);
  if (errors.length) throw new ArchitectureError('INVALID_LAYOUT', errors);
  return { model, graph: ArchitectureGraph.validate(model), layout };
}
