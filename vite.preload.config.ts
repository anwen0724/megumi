import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/product': path.resolve(__dirname, 'packages/product/src'),
      '@megumi/engine': path.resolve(__dirname, 'packages/engine/src'),
      '@megumi/skills': path.resolve(__dirname, 'packages/skills/src'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai/src'),
      '@megumi/observability': path.resolve(__dirname, 'packages/observability/src'),
    },
  },
  build: { outDir: '.vite/preload', rollupOptions: { external: ['electron'] } },
});
