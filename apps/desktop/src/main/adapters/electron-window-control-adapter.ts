// Adapts Electron window controls used by renderer window command IPC.
import { BrowserWindow } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

export interface ElectronWindowControlAdapter {
  minimize(event: IpcMainInvokeEvent): void;
  toggleMaximize(event: IpcMainInvokeEvent): void;
  close(event: IpcMainInvokeEvent): void;
}

export const electronWindowControlAdapter: ElectronWindowControlAdapter = {
  minimize(event) {
    getSenderWindow(event)?.minimize();
  },
  toggleMaximize(event) {
    const window = getSenderWindow(event);

    if (!window) {
      return;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  },
  close(event) {
    getSenderWindow(event)?.close();
  },
};

function getSenderWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}
