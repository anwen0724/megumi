import { app, BrowserWindow } from 'electron';

export interface RegisterAppLifecycleOptions {
  registerAllHandlers: () => void;
  createWindow: () => void;
  dispose?: () => void;
}

export function registerAppLifecycle({
  registerAllHandlers,
  createWindow,
  dispose,
}: RegisterAppLifecycleOptions): void {
  app.whenReady().then(() => {
    registerAllHandlers();
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  if (dispose) {
    app.on('will-quit', () => {
      dispose();
    });
  }
}
