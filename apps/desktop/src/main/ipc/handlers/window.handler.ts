import { IPC_CHANNELS } from '../channels';
import { electronIpcMain, type DesktopIpcMain } from '../../shell/electron-ipc-main-host';
import {
  electronWindowControlHost,
  type DesktopWindowControlHost,
} from '../../shell/electron-window-control-host';

export interface RegisterWindowHandlersOptions {
  ipcMain?: DesktopIpcMain;
  windowControls?: DesktopWindowControlHost;
}

export function registerWindowHandlers(options: RegisterWindowHandlersOptions = {}): void {
  const ipcMain = options.ipcMain ?? electronIpcMain;
  const windowControls = options.windowControls ?? electronWindowControlHost;

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
