/* Configures Desktop development and production builds; electron-vite owns process orchestration. */
import { defineConfig } from 'electron-vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { require as requireTypeScript } from 'tsx/cjs/api';
import delivery from './electron-builder.config.cjs';
import { megumiPackageAliases } from './vite.megumi-package-aliases';

const root = __dirname;
// Isolated build checks can choose a temporary root without changing the installed layout.
const output = path.resolve(process.env.MEGUMI_BUILD_OUTPUT ?? path.join(root, '.vite'));
const alias = [
  { find: '@megumi/desktop', replacement: path.join(root, 'apps/desktop/src') },
  ...megumiPackageAliases,
];

export default defineConfig(({ command }) => ({
  main: {
    resolve: { alias },
    define: {
      MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
      MEGUMI_APP_ID: JSON.stringify(delivery.appId),
    },
    plugins: command === 'build' ? [{
      name: 'megumi-packaged-resources',
      async closeBundle() {
        const { getProductPackagingResources } = requireTypeScript(
          './apps/desktop/src/main/packaging/product-resources.ts', import.meta.url,
        ) as typeof import('./apps/desktop/src/main/packaging/product-resources');
        const resources = path.join(output, 'resources');
        await fs.rm(resources, { recursive: true, force: true });
        for (const resource of getProductPackagingResources(root)) {
          await fs.cp(resource.source, path.join(resources, resource.target), { recursive: true });
        }
      },
    }] : [],
    build: {
      outDir: path.join(output, 'build'),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: path.join(root, 'apps/desktop/src/main/index.ts'),
          'voice-input-worker': path.join(root, 'apps/desktop/src/main/adapters/voice-input/voice-input-worker-entry.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: path.join(output, 'preload'),
      emptyOutDir: true,
      externalizeDeps: false,
      rollupOptions: {
        input: path.join(root, 'apps/desktop/src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    root: path.join(root, 'apps/desktop/src/renderer'),
    base: './',
    resolve: { alias },
    server: { host: '127.0.0.1' },
    build: {
      outDir: path.join(output, 'renderer/main_window'),
      emptyOutDir: true,
      rollupOptions: { input: path.join(root, 'apps/desktop/src/renderer/index.html') },
    },
  },
}));
