import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/coding-agent': path.resolve(__dirname, 'packages/coding-agent'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/command': path.resolve(__dirname, 'packages/command'),
      '@megumi/input': path.resolve(__dirname, 'packages/input'),
      '@megumi/shared': path.resolve(__dirname, 'packages/shared'),
    },
  },
  build: { outDir: '.vite/preload', rollupOptions: { external: ['electron'] } },
});
