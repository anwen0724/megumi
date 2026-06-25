import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@megumi/desktop': path.resolve(__dirname, 'apps/desktop/src'),
      '@megumi/agent': path.resolve(__dirname, 'packages/agent'),
      '@megumi/coding-agent': path.resolve(__dirname, 'packages/coding-agent'),
      '@megumi/ai': path.resolve(__dirname, 'packages/ai'),
      '@megumi/shared': path.resolve(__dirname, 'packages/shared'),
    },
  },
  build: {
    outDir: '.vite/build',
    rollupOptions: {
      external: ['better-sqlite3', 'electron'],
      output: { entryFileNames: 'index.js' },
    },
  },
});
