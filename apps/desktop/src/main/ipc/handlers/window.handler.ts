import { BrowserWindow, ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@megumi/shared/ipc';

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.window.minimize, (event) => {
    getSenderWindow(event)?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, (event) => {
    const window = getSenderWindow(event);

    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  ipcMain.handle(IPC_CHANNELS.window.close, (event) => {
    getSenderWindow(event)?.close();
  });
}

