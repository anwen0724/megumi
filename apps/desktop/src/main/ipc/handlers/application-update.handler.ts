/*
 * Exposes finite Renderer commands to the Main-owned application update Controller.
 */
import { z } from 'zod';
import type { ApplicationUpdateController } from '../../application-update/application-update-controller';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const PreferencePayloadSchema = z.object({ enabled: z.boolean() }).strict();
const EmptyPayloadSchema = z.undefined();

/** Registers update commands without accepting versions, feeds, URLs, or asset paths. */
export function registerApplicationUpdateHandlers(options: {
  readonly controller: ApplicationUpdateController;
  readonly ipcMain?: DesktopIpcMain;
}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.snapshotGet, (_event, raw: unknown) => {
    EmptyPayloadSchema.parse(raw);
    return options.controller.getSnapshot();
  });
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.check, (_event, raw: unknown) => {
    EmptyPayloadSchema.parse(raw);
    return options.controller.checkNow();
  });
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.automaticChecksSet, (_event, raw: unknown) => (
    options.controller.setAutomaticChecksEnabled(PreferencePayloadSchema.parse(raw).enabled)
  ));
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.automaticDownloadsSet, (_event, raw: unknown) => (
    options.controller.setAutomaticDownloadsEnabled(PreferencePayloadSchema.parse(raw).enabled)
  ));
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.download, (_event, raw: unknown) => {
    EmptyPayloadSchema.parse(raw);
    return options.controller.downloadUpdate();
  });
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.restartAndInstall, (_event, raw: unknown) => {
    EmptyPayloadSchema.parse(raw);
    return options.controller.restartAndInstall();
  });
  ipcMain.handle(IPC_CHANNELS.applicationUpdate.releasePageOpen, (_event, raw: unknown) => {
    EmptyPayloadSchema.parse(raw);
    return options.controller.openReleasePage();
  });
}
