/* Supplies Electron packaging facts required to locate Database migrations. */
import { app } from 'electron';

export function getElectronMigrationEnvironment() {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  };
}
