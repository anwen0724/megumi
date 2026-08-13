import { defineConfig } from 'vite';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

// Builds the Node Speech Worker entry into a stable file next to the Main
// bundle. sherpa-onnx-node stays external so the packaged native dependency
// resolves through the app's node_modules inside the worker thread.
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
      external: ['sherpa-onnx-node'],
      output: {
        entryFileNames: 'voice-input-worker.js',
      },
    },
  },
});
