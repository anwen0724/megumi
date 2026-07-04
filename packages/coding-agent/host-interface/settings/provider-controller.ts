// Controller for provider settings operations exposed to UI shells.
import type {
  ProviderApiKeyPayload,
  ProviderDeleteApiKeyPayload,
  ProviderListData,
  ProviderUpdatePayload,
} from '@megumi/shared/ipc';
import type { SettingsService } from '../../settings';

export interface ProviderController {
  list(): Promise<ProviderListData>;
  update(payload: ProviderUpdatePayload): Promise<Record<string, never>>;
  setApiKey(payload: ProviderApiKeyPayload): Promise<Record<string, never>>;
  deleteApiKey(payload: ProviderDeleteApiKeyPayload): Promise<Record<string, never>>;
}

export function createProviderController(
  settingsService: Pick<
    SettingsService,
    'listProviderSettings' | 'updateProviderSettings' | 'setProviderApiKey' | 'clearProviderApiKey'
  >,
): ProviderController {
  return {
    list: async () => {
      const result = settingsService.listProviderSettings();
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {
        providers: result.providers.map((provider) => ({
          providerId: provider.provider_id as ProviderListData['providers'][number]['providerId'],
          displayName: provider.display_name,
          enabled: provider.enabled,
          ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
          modelIds: provider.models,
          hasApiKey: provider.has_api_key,
          credentialSource: provider.credential_source,
          envOverrideActive: provider.env_override_active,
          ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
          ...(provider.api_key_env_customized !== undefined ? {
            apiKeyEnvCustomized: provider.api_key_env_customized,
          } : {}),
        })),
      };
    },
    update: async ({ providerId, ...input }) => {
      const result = settingsService.updateProviderSettings({
        provider_id: providerId,
        patch: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.displayName ? { display_name: input.displayName } : {}),
          ...(input.baseUrl ? { base_url: input.baseUrl } : {}),
          ...(input.modelIds ? { models: input.modelIds } : {}),
          ...(input.apiKeyEnv !== undefined ? { api_key_env: input.apiKeyEnv } : {}),
        },
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
    setApiKey: async (payload) => {
      const result = settingsService.setProviderApiKey({
        provider_id: payload.providerId,
        api_key: payload.apiKey,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
    deleteApiKey: async (payload) => {
      const result = settingsService.clearProviderApiKey({
        provider_id: payload.providerId,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
  };
}
