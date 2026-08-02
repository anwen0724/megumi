/* Supplies Electron product identity and platform facts to Product composition. */

import type { ProductEnvironment } from '@megumi/product';
import { app } from 'electron';

export function getElectronProductEnvironment(): ProductEnvironment {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
}
