/* Builds Desktop's runtime entries for development and distributable packages. */
import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { require as requireTypeScript } from 'tsx/cjs/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Produces the Desktop runtime layout consumed by Electron and the installer. */
export async function buildDesktop(output = path.join(root, '.vite')) {
  const { getProductPackagingResources } = requireTypeScript('../../apps/desktop/src/main/packaging/product-resources.ts', import.meta.url);
  const resourcesDirectory = path.join(output, 'resources');
  await fs.rm(resourcesDirectory, { recursive: true, force: true });
  for (const resource of getProductPackagingResources(root)) {
    await fs.cp(resource.source, path.join(resourcesDirectory, resource.target), { recursive: true });
  }
  for (const [entry, directory, emptyOutDir] of [
    ['main', 'build', true],
    ['worker', 'build', false],
    ['preload', 'preload', true],
    ['renderer', 'renderer/main_window', true],
  ]) {
    await build({
      configFile: path.join(root, `vite.${entry}.config.ts`),
      build: { outDir: path.join(output, directory), emptyOutDir },
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDesktop(process.argv[2]);
}
