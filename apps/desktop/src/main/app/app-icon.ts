/* Resolves the shared Desktop icon in development and installed application resources. */
import { app } from 'electron';
import path from 'node:path';

/** Returns the same native icon for the tray, main window, and Source windows. */
export function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'desktop', 'app-icon.ico')
    : path.join(app.getAppPath(), 'apps', 'desktop', 'assets', 'app-icon.ico');
}
