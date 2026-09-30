/* Prepares real packaged resources and an isolated Home at Electron's system boundary. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { getProductPackagingResources } from '@megumi/desktop/main/packaging/product-resources';
import { electronBoundary } from './electron-boundary';

export async function createDesktopEnvironment() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-desktop-'));
  const home = path.join(root, 'home');
  const resourcesPath = path.join(root, 'resources');
  for (const resource of getProductPackagingResources(process.cwd())) {
    await fs.cp(resource.source, path.join(resourcesPath, resource.target), { recursive: true });
  }
  const previous = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true });
  electronBoundary.app.root = root;
  electronBoundary.app.isPackaged = true;
  vi.stubEnv('MEGUMI_HOME', home);
  return {
    root, home, resourcesPath,
    async close() {
      if (previous) Object.defineProperty(process, 'resourcesPath', previous);
      else Reflect.deleteProperty(process, 'resourcesPath');
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}
