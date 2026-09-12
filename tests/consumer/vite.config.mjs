import { defineConfig } from 'vite';
export default defineConfig({
  base: '/embedded/maps/',
  build: { assetsInlineLimit: 0 },
  preview: { host: '127.0.0.1', port: 44891, strictPort: true },
});
