import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/product': path.resolve(__dirname, 'packages/product'),
      '@megumi/coding-agent': path.resolve(__dirname, 'packages/coding-agent'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
    },
  },
  build: { outDir: '.vite/preload', rollupOptions: { external: ['electron'] } },
});
