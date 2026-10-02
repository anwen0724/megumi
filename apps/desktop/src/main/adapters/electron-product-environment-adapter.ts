/* Supplies Electron product identity and platform facts to Product composition. */

import type { CreateApplicationOptions } from '@megumi/application/index';

type ProductEnvironment = NonNullable<CreateApplicationOptions['productEnvironment']>;
import { app } from 'electron';

export function getElectronProductEnvironment(): ProductEnvironment {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
}
