/* Supplies Electron process facts without interpreting Product resource layout. */
import { app } from 'electron';

export function getElectronProductEnvironment() {
  return {
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
  };
}
