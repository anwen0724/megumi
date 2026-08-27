/*
 * Exposes finite Renderer commands to the Main-owned application update Controller.
 */
import { z } from 'zod';
import type { ApplicationUpdateController } from '../../application-update/application-update-controller';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const PreferencePayloadSchema = z.object({ enabled: z.boolean() }).strict();

/** Registers update commands without accepting versions, feeds, URLs, or asset paths. */
export function registerApplicationUpdateHandlers(options: {
  readonly controller: ApplicationUpdateController;
  readonly ipcMain?: DesktopIpcMain;
}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.snapshotGet, () => options.controller.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.check, () => options.controller.checkNow());
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.automaticChecksSet, (_event, raw: unknown) => (
    options.controller.setAutomaticChecksEnabled(PreferencePayloadSchema.parse(raw).enabled)
  ));
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.automaticDownloadsSet, (_event, raw: unknown) => (
    options.controller.setAutomaticDownloadsEnabled(PreferencePayloadSchema.parse(raw).enabled)
  ));
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.download, () => options.controller.downloadUpdate());
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.restartAndInstall, () => options.controller.restartAndInstall());
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.releasePageOpen, () => options.controller.openReleasePage());
}
