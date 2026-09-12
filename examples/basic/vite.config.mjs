import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('./', import.meta.url).pathname,
  base: './',
  server: { host: '127.0.0.1', port: 44889, strictPort: true },
  preview: { host: '127.0.0.1', port: 44889, strictPort: true },
  build: {
    outDir: '../../.runtime/example',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
