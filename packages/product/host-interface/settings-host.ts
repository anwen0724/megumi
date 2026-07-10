/*
 * Implements the SettingsHost interface over the Coding Agent Settings module.
 */
import type { SettingsService } from '../../coding-agent/settings';
import {
  toProviderPublicStatusUiDto,
  toSettingsRawPatch,
  toSettingsUiResolved,
} from './settings-host-mapper';
import type {
  EmptyUiResult,
  ProviderDeleteUiRequest,
  ProviderDeleteApiKeyUiRequest,
  ProviderListUiRequest,
  ProviderListUiResult,
  ProviderSetApiKeyUiRequest,
  ProviderUpdateUiRequest,
  SettingsGetUiRequest,
  SettingsGetUiResult,
  SettingsUpdateUiRequest,
  SettingsUpdateUiResult,
} from './settings-host-types';

export interface SettingsHost {
  get(request?: SettingsGetUiRequest): Promise<SettingsGetUiResult>;
  update(request: SettingsUpdateUiRequest): Promise<SettingsUpdateUiResult>;
  listProviders(request?: ProviderListUiRequest): Promise<ProviderListUiResult>;
  updateProvider(request: ProviderUpdateUiRequest): Promise<EmptyUiResult>;
  deleteProvider(request: ProviderDeleteUiRequest): Promise<EmptyUiResult>;
  setProviderApiKey(request: ProviderSetApiKeyUiRequest): Promise<EmptyUiResult>;
  deleteProviderApiKey(request: ProviderDeleteApiKeyUiRequest): Promise<EmptyUiResult>;
}

export function createSettingsHost(
  settingsService: Pick<
    SettingsService,
    | 'getResolvedSettings'
    | 'updateSettings'
    | 'listProviderSettings'
    | 'updateProviderSettings'
    | 'deleteProviderSettings'
    | 'setProviderApiKey'
    | 'clearProviderApiKey'
  >,
): SettingsHost {
  return {
    async get() {
      return { settings: toSettingsUiResolved(unwrap(settingsService.getResolvedSettings())) };
    },
    async update(patch) {
      const result = settingsService.updateSettings({ patch: toSettingsRawPatch(patch) });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { settings: toSettingsUiResolved(result.settings) };
    },
    async listProviders() {
      const result = settingsService.listProviderSettings();
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return { providers: result.providers.map(toProviderPublicStatusUiDto) };
    },
    async updateProvider({ providerId, ...input }) {
      const result = settingsService.updateProviderSettings({
        provider_id: providerId,
        patch: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.protocol ? { protocol: input.protocol } : {}),
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
    async deleteProvider(request) {
      const result = settingsService.deleteProviderSettings({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
    async setProviderApiKey(request) {
      const result = settingsService.setProviderApiKey({
        provider_id: request.providerId,
        api_key: request.apiKey,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
    async deleteProviderApiKey(request) {
      const result = settingsService.clearProviderApiKey({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        throw new Error(result.failure.message);
      }
      return {};
    },
  };
}

function unwrap(result: ReturnType<SettingsService['getResolvedSettings']>) {
  if (result.status === 'failed') {
    throw new Error(result.failure.message);
  }
  return result.settings;
}
