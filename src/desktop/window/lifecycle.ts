// Owns Electron app lifecycle wiring for the desktop shell.
import { app, BrowserWindow } from 'electron';

export function registerDesktopLifecycle(options: { createWindow(): void; cleanup(): Promise<void> | void }): void {
  app.whenReady().then(options.createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) options.createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', () => {
    void options.cleanup();
  });
}
