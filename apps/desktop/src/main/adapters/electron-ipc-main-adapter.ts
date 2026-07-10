// Adapts Electron ipcMain so handler modules do not import Electron directly.
import { ipcMain } from 'electron';
import type { IpcMain } from 'electron';

export type DesktopIpcMain = Pick<IpcMain, 'handle'>;

export const electronIpcMain: DesktopIpcMain = ipcMain;
