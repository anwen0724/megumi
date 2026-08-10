/*
 * Bridges renderer shell commands to the Main-owned CharacterWindowController.
 * These commands move window state only and are intentionally outside ProductHost.
 */
import { z } from 'zod';
import type { CharacterWindowController } from '../../app/character-window-controller';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const SessionSelectionSchema = z.object({ sessionId: z.string().min(1).nullable() }).strict();

export function registerCharacterHandlers(options: {
  readonly controller: CharacterWindowController;
  readonly ipcMain?: DesktopIpcMain;
}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.character.show, () => options.controller.show());
  ipcMain.handle(IPC_CHANNELS.character.hide, () => options.controller.hide());
  ipcMain.handle(IPC_CHANNELS.character.snapshot, () => options.controller.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.character.toggleAlwaysOnTop, () => options.controller.toggleAlwaysOnTop());
  ipcMain.handle(IPC_CHANNELS.character.selectSession, (_event, value: unknown) => {
    const payload = SessionSelectionSchema.parse(value);
    return options.controller.selectSession(payload.sessionId);
  });
}
