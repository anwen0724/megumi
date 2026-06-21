// Adapts Electron BrowserWindow access for Desktop Main window-aware publishing.
import { BrowserWindow } from 'electron';

export interface DesktopWebContents {
  send(channel: string, ...args: unknown[]): void;
}

export interface DesktopWindow {
  webContents: DesktopWebContents;
}

export interface DesktopWindowHost {
  getAllWindows(): DesktopWindow[];
}

export const electronWindowHost: DesktopWindowHost = {
  getAllWindows() {
    return BrowserWindow.getAllWindows();
  },
};
