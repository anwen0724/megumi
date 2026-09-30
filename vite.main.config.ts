/* Builds the Desktop Main process with explicit Electron runtime boundaries. */
import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import delivery from './electron-builder.config.cjs';
import path from 'path';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

export default defineConfig({
  define: {
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(process.env.MEGUMI_RENDERER_URL ?? ''),
    MEGUMI_APP_ID: JSON.stringify(delivery.appId),
  },
  resolve: {
    alias: [
      { find: '@megumi/desktop', replacement: path.resolve(__dirname, 'apps/desktop/src') },
      ...megumiPackageAliases,
    ],
  },
  build: {
    target: 'node20',
    minify: false,
    outDir: '.vite/build',
    lib: { entry: 'apps/desktop/src/main/index.ts', formats: ['cjs'], fileName: () => 'index.js' },
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map(name => `node:${name}`), 'better-sqlite3', 'electron', 'electron-updater', 'sherpa-onnx-node'],
      output: { entryFileNames: 'index.js' },
    },
  },
});
