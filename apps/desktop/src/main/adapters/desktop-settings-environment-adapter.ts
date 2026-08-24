/* Provides named process-environment reads for Settings without passing the full environment object. */

import type { SettingsEnvironment as ProductSettingsEnvironment } from '@megumi/settings';

export function createDesktopSettingsEnvironment(): ProductSettingsEnvironment {
  return {
    readVariable: (name) => process.env[name],
  };
}
