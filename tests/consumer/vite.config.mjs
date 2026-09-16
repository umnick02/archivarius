import { defineConfig } from 'vite';
export default defineConfig({
  base: '/embedded/maps/',
  build: { assetsInlineLimit: 0 },
});
