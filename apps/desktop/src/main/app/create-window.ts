import { BrowserWindow } from 'electron';
import path from 'path';

export interface CreateMainWindowOptions {
  devServerUrl?: string;
  rendererName: string;
  dirname: string;
}

export function createMainWindow({
  devServerUrl,
  rendererName,
  dirname,
}: CreateMainWindowOptions): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 1100,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    title: 'Megumi',
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(dirname, `../renderer/${rendererName}/index.html`));
  }

  return mainWindow;
}
