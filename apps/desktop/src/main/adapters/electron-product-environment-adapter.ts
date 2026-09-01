/* Supplies Electron product identity and platform facts to Product composition. */

import type { ComposeApplicationOptions } from '@megumi/composition';

type ProductEnvironment = NonNullable<ComposeApplicationOptions['productEnvironment']>;
import { app } from 'electron';

export function getElectronProductEnvironment(): ProductEnvironment {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
}
