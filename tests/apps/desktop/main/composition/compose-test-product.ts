/* Shared two-step application composition for tests: capabilities, then Host. */
import {
  composeProduct,
  composeProductCapabilities,
  type ComposeProductOptions,
  type ProductCapabilitiesOptions,
} from '@megumi/desktop/main/shell-composition/application-host-composition';
import type { ProductRuntime } from '@megumi/desktop/main/shell-composition/application-runtime';

export function composeTestProduct(
  capabilitiesOptions: ProductCapabilitiesOptions,
  productOverrides: Partial<Pick<
    ComposeProductOptions,
    'directoryPicker' | 'fileOpen' | 'attachmentPicker' | 'localFileAvailability' | 'diagnosticBundleSave' | 'voice'
  >> = {},
): ProductRuntime {
  const capabilities = composeProductCapabilities(capabilitiesOptions);
  return composeProduct({
    capabilities,
    ...productOverrides,
  });
}
