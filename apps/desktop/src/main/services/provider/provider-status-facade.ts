// Desktop facade over the product provider settings service. The provider IPC
// handler depends on this facade rather than the product class directly; this is
// the provider/ directory's UI facade home in the desktop shell.
import type { ProviderId, ProviderPublicStatus, ProviderSettings } from '@megumi/shared/provider';
import type { ProviderSettingsService, ProviderSettingsUpdateInput } from '@megumi/coding-agent/settings';

export interface DesktopProviderStatusService {
  getProviderSettings(providerId: ProviderId): Promise<ProviderSettings>;
  listProviderStatuses(): Promise<ProviderPublicStatus[]>;
  updateProviderSettings(providerId: ProviderId, input: ProviderSettingsUpdateInput): Promise<ProviderSettings>;
  setProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderSettings>;
  deleteProviderApiKey(providerId: ProviderId): Promise<ProviderSettings>;
}

export function createDesktopProviderStatusService(
  runtime: ProviderSettingsService,
): DesktopProviderStatusService {
  return {
    getProviderSettings: (providerId) => runtime.getProviderSettings(providerId),
    listProviderStatuses: () => runtime.listProviderStatuses(),
    updateProviderSettings: (providerId, input) => runtime.updateProviderSettings(providerId, input),
    setProviderApiKey: (providerId, apiKey) => runtime.setProviderApiKey(providerId, apiKey),
    deleteProviderApiKey: (providerId) => runtime.deleteProviderApiKey(providerId),
  };
}
