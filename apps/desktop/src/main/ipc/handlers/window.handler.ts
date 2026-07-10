import { IPC_CHANNELS } from '../channels';
import { electronIpcMain, type DesktopIpcMain } from '../../adapters/electron-ipc-main-adapter';
import {
  electronWindowControlAdapter,
  type ElectronWindowControlAdapter,
} from '../../adapters/electron-window-control-adapter';

export interface RegisterWindowHandlersOptions {
  ipcMain?: DesktopIpcMain;
  windowControls?: ElectronWindowControlAdapter;
}

export function registerWindowHandlers(options: RegisterWindowHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const windowControls = options.windowControls ?? electronWindowControlAdapter;

  ipcMain.handle(IPC_CHANNELS.window.minimize, (event) => {
    windowControls.minimize(event);
  });

  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, (event) => {
    windowControls.toggleMaximize(event);
  });

  ipcMain.handle(IPC_CHANNELS.window.close, (event) => {
    windowControls.close(event);
  });
}
