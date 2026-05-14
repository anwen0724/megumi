import { app, BrowserWindow } from 'electron';

export interface RegisterAppLifecycleOptions {
  runMigrations: () => void;
  registerAllHandlers: () => void;
  createWindow: () => void;
}

export function registerAppLifecycle({
  runMigrations,
  registerAllHandlers,
  createWindow,
}: RegisterAppLifecycleOptions): void {
  app.whenReady().then(() => {
    runMigrations();
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
}
