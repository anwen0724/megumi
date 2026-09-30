import { defineConfig } from 'vite';
import path from 'path';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

// Desktop loads the production renderer from file:// with relative asset URLs.
export default defineConfig({
  base: './',
  resolve: {
    alias: [
      { find: '@megumi/desktop', replacement: path.resolve(__dirname, 'apps/desktop/src') },
      ...megumiPackageAliases,
    ],
  },
  root: 'apps/desktop/src/renderer',
  // Keep the development server and Chromium on the same address family.
  server: { host: '127.0.0.1' },
  build: { outDir: '../../../../.vite/renderer/main_window' },
});
