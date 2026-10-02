/* Starts real update composition against isolated Home files and an external HTTP fixture. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { createApplicationUpdate } from '@megumi/desktop/main/application-update/application-update-composition';
import { electronBoundary, installElectronModuleBoundary } from './electron-boundary';
import { createUpdateSource } from './update-source';

/** Sets up only system boundaries; the controller, persistence and updater remain real. */
export async function createUpdateSession(prepareToQuit: () => Promise<void> = async () => undefined) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-update-'));
  electronBoundary.app.root = home;
  electronBoundary.app.isPackaged = true;
  vi.stubGlobal('MEGUMI_APP_ID', 'com.megumi.desktop');
  vi.stubEnv('LOCALAPPDATA', path.join(home, 'cache'));
  const resourcesBefore = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: home, configurable: true });
  const restoreElectron = installElectronModuleBoundary();
  const fixture = await createUpdateSource();
  await fs.writeFile(path.join(home, 'app-update.yml'),
    `provider: generic\nurl: ${fixture.url}\nupdaterCacheDirName: fixture-updater\n`);
  const controller = createApplicationUpdate({ megumiHomePath: home, logger: console, prepareToQuit });
  return {
    ...fixture, controller, home,
    async close() {
      controller.dispose();
      await fixture.close();
      restoreElectron();
      if (resourcesBefore) Object.defineProperty(process, 'resourcesPath', resourcesBefore);
      else Reflect.deleteProperty(process, 'resourcesPath');
      await fs.rm(home, { recursive: true, force: true });
    },
  };
}
