// Controller for provider settings operations exposed to UI shells.
import type {
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderUpdatePayload,
} from '@megumi/shared/ipc';
import type { ProviderSettingsPort } from '../../settings';

export interface ProviderController {
  list(): Promise<ProviderListData>;
  update(payload: ProviderUpdatePayload): Promise<Record<string, never>>;
  setApiKey(payload: ProviderApiKeyPayload): Promise<Record<string, never>>;
  deleteApiKey(payload: ProviderDeleteApiKeyPayload): Promise<Record<string, never>>;
}

export function createProviderController(
  providerSettingsService: ProviderSettingsPort,
): ProviderController {
  return {
    list: async () => ({ providers: await providerSettingsService.listProviderStatuses() }),
    update: async ({ providerId, ...input }) => {
      await providerSettingsService.updateProviderSettings(providerId, input);
      return {};
    },
    setApiKey: async (payload) => {
      await providerSettingsService.setProviderApiKey(payload.providerId, payload.apiKey);
      return {};
    },
    deleteApiKey: async (payload) => {
      await providerSettingsService.deleteProviderApiKey(payload.providerId);
      return {};
    },
  };
}
