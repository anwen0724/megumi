/*
 * Bridges renderer shell commands to the Main-owned CharacterWindowController.
 * These commands move window state only and are intentionally outside ProductHost.
 */
import { z } from 'zod';
import type { CharacterWindowController } from '../../app/character-window-controller';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import { IPC_CHANNELS } from '../channels';

const SessionSelectionSchema = z.object({ sessionId: z.string().min(1).nullable() }).strict();
const ShapeRectSchema = z.object({
  x: z.number().int().min(0).max(16_384),
  y: z.number().int().min(0).max(16_384),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
}).strict();
const ShapeSchema = z.object({ rects: z.array(ShapeRectSchema).max(1_024) }).strict();
const MoveToSchema = z.object({
  x: z.number().int().min(-100_000).max(100_000),
  y: z.number().int().min(-100_000).max(100_000),
}).strict();
const ScaleSchema = z.object({ scale: z.number().min(0.7).max(1.3) }).strict();

export function registerCharacterHandlers(options: {
  readonly controller: CharacterWindowController;
  readonly ipcMain?: DesktopIpcMain;
}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  ipcMain.handle(IPC_CHANNELS.character.show, () => options.controller.show());
  ipcMain.handle(IPC_CHANNELS.character.hide, () => options.controller.hide());
  ipcMain.handle(IPC_CHANNELS.character.snapshot, () => options.controller.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.character.toggleAlwaysOnTop, () => options.controller.toggleAlwaysOnTop());
  ipcMain.handle(IPC_CHANNELS.character.setScale, (_event, value: unknown) => {
    const payload = ScaleSchema.parse(value);
    return options.controller.setScale(payload.scale);
  });
  ipcMain.handle(IPC_CHANNELS.character.setShape, (_event, value: unknown) => {
    const payload = ShapeSchema.parse(value);
    options.controller.setShape(payload.rects);
  });
  ipcMain.handle(IPC_CHANNELS.character.moveTo, (_event, value: unknown) => {
    options.controller.moveTo(MoveToSchema.parse(value));
  });
  ipcMain.handle(IPC_CHANNELS.character.openSettings, () => options.controller.openSettings());
  ipcMain.handle(IPC_CHANNELS.character.showMainWindow, () => options.controller.showMainWindow());
  ipcMain.handle(IPC_CHANNELS.character.selectSession, (_event, value: unknown) => {
    const payload = SessionSelectionSchema.parse(value);
    return options.controller.selectSession(payload.sessionId);
  });
}
