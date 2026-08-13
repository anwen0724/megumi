import { defineConfig } from 'vite';
import path from 'path';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

// Builds the Node Speech Worker entry into a stable file next to the Main
// bundle. sherpa-onnx-node stays external so the packaged native dependency
// resolves through the app's node_modules inside the worker thread.
const workerEntry = path.resolve(
  __dirname,
  'apps/desktop/src/main/adapters/voice-input/voice-input-worker-entry.ts',
);

export default defineConfig({
  resolve: {
    alias: [
      ...megumiPackageAliases,
    ],
  },
  build: {
    outDir: '.vite/build',
    ssr: true,
    rollupOptions: {
      input: workerEntry,
      external: ['sherpa-onnx-node'],
      output: {
        entryFileNames: 'voice-input-worker.js',
        format: 'cjs',
      },
    },
  },
});
