/* Composes Desktop updates from NSIS identity, electron-updater and the Home preference store. */
import { app, shell } from 'electron';
import type { DesktopRuntimeLogger } from '../runtime-logger';
import { resolveUpdateSupport } from '../installation/installation-environment';
import { createApplicationUpdateController, type ApplicationUpdateController } from './application-update-controller';
import { ElectronUpdaterAdapter } from './electron-updater-adapter';
import { createFileUpdatePreferencesStore } from './update-preferences-store';

declare const MEGUMI_APP_ID: string;

/** Builds the single update owner after Desktop has resolved its real Home. */
export function composeApplicationUpdate(request: {
  readonly megumiHomePath: string; readonly logger: DesktopRuntimeLogger;
  readonly prepareToQuit: () => Promise<void>;
}): ApplicationUpdateController {
  const supportReason = resolveUpdateSupport({
    isPackaged: app.isPackaged, platform: process.platform, arch: process.arch,
    appId: MEGUMI_APP_ID, version: app.getVersion(), executablePath: app.getPath('exe'), logger: request.logger,
  });
  return createApplicationUpdateController({
    currentVersion: app.getVersion(), platform: process.platform, arch: process.arch, supportReason,
    preferences: createFileUpdatePreferencesStore(request),
    updater: supportReason ? undefined : new ElectronUpdaterAdapter(),
    prepareToQuit: request.prepareToQuit,
    openExternal: url => shell.openExternal(url),
    schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
    now: () => new Date(), logger: request.logger,
  });
}
