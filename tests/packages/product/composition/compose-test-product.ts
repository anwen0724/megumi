/* Shared three-step Product composition for tests: capabilities, Discovery Agent, Product. */
import { createDiscoveryAgent } from '@megumi/discovery-agent';
import {
  composeProduct,
  composeProductCapabilities,
  type ComposeProductOptions,
  type ProductCapabilitiesOptions,
  type ProductRuntime,
} from '@megumi/product';

export function composeTestProduct(
  capabilitiesOptions: ProductCapabilitiesOptions,
  productOverrides: Partial<Pick<
    ComposeProductOptions,
    'directoryPicker' | 'fileOpen' | 'attachmentPicker' | 'localFileAvailability' | 'diagnosticBundleSave' | 'voice'
  >> = {},
): ProductRuntime {
  const capabilities = composeProductCapabilities(capabilitiesOptions);
  const discoveryAgent = createDiscoveryAgent(capabilities.discoveryAgentOptions);
  return composeProduct({
    capabilities,
    discoveryAgent,
    ...productOverrides,
  });
}
