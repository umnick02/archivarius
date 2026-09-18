import { layoutModel } from './geometry.mjs';

// elkjs decides what it is the first time an engine is constructed: a context
// without a `document` makes it install its own message handler and hand back no
// engine at all, so this thread presents itself as a document-bearing host first.
globalThis.document ??= {};

// The layout thread: one model in, one geometry out, and a message rather than an
// exception for a model the graph refuses, so the page can report it.
self.addEventListener('message', async ({ data }) => {
  try {
    self.postMessage({
      ok: true,
      layout: await layoutModel(data.model, undefined, { cached: data.cached }),
    });
  } catch (error) {
    self.postMessage({ ok: false, message: error.message });
  }
});
