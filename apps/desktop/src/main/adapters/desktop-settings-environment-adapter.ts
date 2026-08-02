/* Provides named process-environment reads for Settings without passing the full environment object. */

import type { ProductSettingsEnvironment } from '@megumi/product';

export function createDesktopSettingsEnvironment(): ProductSettingsEnvironment {
  return {
    readVariable: (name) => process.env[name],
  };
}
