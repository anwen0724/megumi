/*
 * Composes the production update Controller from Electron, GitHub, and Megumi Home Adapters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, shell } from 'electron';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import {
  createApplicationUpdateController,
  type ApplicationUpdateController,
} from './application-update-controller';
import { createElectronAutoUpdaterAdapter } from './electron-auto-updater-adapter';
import { createGithubReleaseMetadataAdapter } from './github-release-metadata-adapter';
import { createFileUpdatePreferencesStore } from './update-preferences-store';

/** Builds the single production update Owner for the Desktop process. */
export function composeApplicationUpdate(request: {
  readonly megumiHomePath: string;
  readonly logger: DesktopRuntimeLogger;
  readonly prepareToQuit: () => Promise<void>;
}): ApplicationUpdateController {
  return createApplicationUpdateController({
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    isSquirrelInstalled: squirrelUpdateExecutableExists(process.execPath),
    isSquirrelFirstRun: process.argv.includes('--squirrel-firstrun'),
    preferences: createFileUpdatePreferencesStore({ megumiHomePath: request.megumiHomePath }),
    releaseMetadata: createGithubReleaseMetadataAdapter(),
    updater: createElectronAutoUpdaterAdapter(),
    prepareToQuit: request.prepareToQuit,
    openExternal: (url) => shell.openExternal(url).then(() => undefined),
    schedule: (callback, delayMs) => {
      const timeout = setTimeout(callback, delayMs);
      return () => clearTimeout(timeout);
    },
    now: () => new Date(),
    logger: request.logger,
  });
}

function squirrelUpdateExecutableExists(executablePath: string): boolean {
  const updateExecutable = path.resolve(path.dirname(executablePath), '..', 'Update.exe');
  return fs.existsSync(updateExecutable);
}
