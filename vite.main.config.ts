import { defineConfig } from 'vite';
import path from 'path';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@megumi/desktop', replacement: path.resolve(__dirname, 'apps/desktop/src') },
      ...megumiPackageAliases,
    ],
  },
  build: {
    outDir: '.vite/build',
    rollupOptions: {
      external: ['better-sqlite3', 'electron', 'sherpa-onnx-node'],
      output: { entryFileNames: 'index.js' },
    },
  },
});
