/* Builds the isolated Desktop bridge as a CommonJS Electron preload. */
import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
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
    target: 'node20',
    minify: false,
    outDir: '.vite/preload',
    lib: { entry: 'apps/desktop/src/preload/index.ts', formats: ['cjs'], fileName: () => 'index.js' },
    rollupOptions: { external: [...builtinModules, ...builtinModules.map(name => `node:${name}`), 'electron'] },
  },
});
