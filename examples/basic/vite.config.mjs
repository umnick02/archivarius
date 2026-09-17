import { defineConfig } from 'vite';

const port = Number(process.env.PORT || 44889);

export default defineConfig({
  root: new URL('./', import.meta.url).pathname,
  base: './',
  // The demo models are owned by `models/`, not copied here: this page serves
  // the same files the suites read.
  publicDir: new URL('../../models/', import.meta.url).pathname,
  server: { host: '127.0.0.1', port, strictPort: true },
  preview: { host: '127.0.0.1', port, strictPort: true },
  build: {
    outDir: '../../.runtime/example',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
