import { BrowserWindow, shell } from 'electron';
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
    width: 1400,
    height: 1000,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f5ef',
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = safeExternalUrl(url);
    if (parsed) void shell.openExternal(parsed);
    return { action: 'deny' };
  });

  return mainWindow;
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
