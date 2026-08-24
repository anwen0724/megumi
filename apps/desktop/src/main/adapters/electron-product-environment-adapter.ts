/* Supplies Electron product identity and platform facts to Product composition. */

import type { ProductCapabilitiesOptions } from '../shell-composition/harness-capabilities';

type ProductEnvironment = NonNullable<ProductCapabilitiesOptions['productEnvironment']>;
import { app } from 'electron';

export function getElectronProductEnvironment(): ProductEnvironment {
  return {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  };
}
