import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/product': path.resolve(__dirname, 'packages/product'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/skills': path.resolve(__dirname, 'packages/skills'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai/src'),
      '@megumi/observability': path.resolve(__dirname, 'packages/observability'),
    },
  },
  build: { outDir: '.vite/preload', rollupOptions: { external: ['electron'] } },
});
