/*
 * Creates the transparent Desktop window that hosts Megumi's character presence.
 * Window lifecycle and product coordination remain owned by CharacterWindowController.
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';

export interface CreateCharacterWindowOptions {
  readonly devServerUrl?: string;
  readonly rendererName: string;
  readonly dirname: string;
}

export function createCharacterWindow(options: CreateCharacterWindowOptions): BrowserWindow {
  const characterWindow = new BrowserWindow({
    width: 360,
    height: 680,
    minWidth: 280,
    minHeight: 460,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    autoHideMenuBar: true,
    title: 'Megumi Character',
    webPreferences: {
      preload: path.join(options.dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (options.devServerUrl) {
    const url = new URL(options.devServerUrl);
    url.searchParams.set('megumiWindowRole', 'character');
    void characterWindow.loadURL(url.toString());
  } else {
    void characterWindow.loadFile(
      path.join(options.dirname, `../renderer/${options.rendererName}/index.html`),
      { query: { megumiWindowRole: 'character' } },
    );
  }

  return characterWindow;
}
