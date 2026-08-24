/*
 * Implements Product Settings operations using the Settings public interface.
 */
import type {
  Settings,
  SettingsFailureResult,
  SettingsResolved,
  SettingsThemeName,
} from '@megumi/settings';
import {
  fromPermissionRuleUi,
  toHostFailure,
  toProviderCatalogUiDto,
  toProviderPublicStatusUiDto,
  toProviderSettingsUiDto,
  toSettingsRawPatch,
  toSettingsUiResolved,
  toVoiceTtsPublicUiDto,
  type EmptyUiResult,
  type ProviderDeleteApiKeyUiRequest,
  type ProviderDeleteUiRequest,
  type ProviderListUiRequest,
  type ProviderListUiResult,
  type ProviderSetApiKeyUiRequest,
  type ProviderUpdateUiRequest,
  type SettingsCompleteSetupUiRequest,
  type SettingsCompleteSetupUiResult,
  type SettingsGetUiRequest,
  type SettingsGetUiResult,
  type SettingsPermissionOptions,
  type SettingsUpdateUiRequest,
  type SettingsUpdateUiResult,
  type SettingsHost,
  type DiscoverySourceCredentialStatusUiResult,
  type VoiceTtsApiKeyUiRequest,
  type VoiceTtsKeyUiResult,
} from '../host/settings-host';

/** Creates the Product operations exposed through SettingsHost. */
export function createSettingsOperations(
  settings: Settings,
  permissionOptions: SettingsPermissionOptions = {},
): SettingsHost {
  return {
    async get() {
      const resolved = settings.resolve();
      if (resolved.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(resolved.failure) };
      }
      const diagnostics = settings.getFileDiagnostics();
      const webSearch = settings.resolveWebSearch();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      const voiceTts = settings.resolveVoiceTts();
      if (voiceTts.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(voiceTts.failure) };
      }
      return {
        status: 'ok',
        settings: toSettingsUiResolved(resolved.settings, webSearch.settings, voiceTts.settings, permissionOptions),
        unknownKeys: diagnostics.status === 'ok' ? diagnostics.unknownKeys : [],
      };
    },

    async update(patch) {
      const rawPatch = toSettingsRawPatch(patch);
      let result = Object.keys(rawPatch).length > 0
        ? settings.update({ patch: rawPatch })
        : resolveUpdatedSettings(settings);
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }

      const ruleChange = patch.permissions?.ruleChange;
      if (ruleChange) {
        const rule = fromPermissionRuleUi(ruleChange.rule);
        const changed = settings.changePermissionRules({
          operation: ruleChange.operation,
          effect: ruleChange.rule.effect,
          rules: [rule],
          ...(rule.source === 'workspace' ? { workspace_id: rule.source_id } : {}),
          ...(rule.source === 'session' ? { session_id: rule.source_id } : {}),
        });
        if (changed.status === 'failed') {
          return { status: 'failed', failure: toHostFailure(changed.failure) };
        }
        result = { status: 'updated', settings: changed.settings };
      }

      const webSearch = settings.resolveWebSearch();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      const voiceTts = settings.resolveVoiceTts();
      if (voiceTts.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(voiceTts.failure) };
      }
      return {
        status: 'updated',
        settings: toSettingsUiResolved(result.settings, webSearch.settings, voiceTts.settings, permissionOptions),
      };
    },

    async completeSetup(request) {
      const result = settings.completeSetup({
        ...(request.language ? { language: request.language } : {}),
        ...(request.theme ? { theme: request.theme as SettingsThemeName } : {}),
        ...(request.provider ? {
          provider: {
            provider_id: request.provider.providerId,
            ...(request.provider.enabled !== undefined ? { enabled: request.provider.enabled } : {}),
            ...(request.provider.protocol ? { api: request.provider.protocol } : {}),
            ...(request.provider.displayName !== undefined ? { display_name: request.provider.displayName } : {}),
            ...(request.provider.baseUrl !== undefined ? { base_url: request.provider.baseUrl } : {}),
            ...(request.provider.modelIds !== undefined ? { models: request.provider.modelIds } : {}),
            ...(request.provider.apiKey ? { api_key: request.provider.apiKey } : {}),
            ...(request.provider.apiKeyEnv !== undefined ? { api_key_env: request.provider.apiKeyEnv } : {}),
          },
        } : {}),
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }

      const webSearch = settings.resolveWebSearch();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      const voiceTts = settings.resolveVoiceTts();
      if (voiceTts.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(voiceTts.failure) };
      }
      return {
        status: 'completed',
        settings: toSettingsUiResolved(result.settings, webSearch.settings, voiceTts.settings, permissionOptions),
      };
    },

    async listProviders() {
      const result = settings.listProviders();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return {
        status: 'ok',
        providers: result.providers.map(toProviderPublicStatusUiDto),
        catalog: settings.listProviderCatalog().map(toProviderCatalogUiDto),
      };
    },

    async updateProvider({ providerId, ...input }) {
      const modelPatch = input.models !== undefined
        ? Object.fromEntries(input.models.map((model) => [model.modelId, {
            ...(model.displayName ? { display_name: model.displayName } : {}),
            ...(model.contextWindowTokens ? { context_window_tokens: model.contextWindowTokens } : {}),
            ...(model.imageInput !== undefined ? { capabilities: { imageInput: model.imageInput } } : {}),
          }]))
        : input.modelIds !== undefined
          ? Object.fromEntries(input.modelIds.map((modelId) => [modelId, {
              ...((input.modelCapabilities?.[modelId] && Object.keys(input.modelCapabilities[modelId]).length > 0)
                ? { capabilities: input.modelCapabilities[modelId] }
                : {}),
            }]))
          : undefined;
      const result = settings.updateProvider({
        provider_id: providerId,
        patch: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.protocol !== undefined ? { api: input.protocol } : {}),
          ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
          ...(input.baseUrl !== undefined ? { base_url: input.baseUrl } : {}),
          ...(modelPatch !== undefined ? { models: modelPatch } : {}),
          ...(input.apiKeyEnv !== undefined ? { api_key_env: input.apiKeyEnv } : {}),
        },
      });
      return result.status === 'failed'
        ? { status: 'failed', failure: toHostFailure(result.failure) }
        : { status: 'updated', provider: toProviderSettingsUiDto(result.provider) };
    },

    async deleteProvider(request) {
      const result = settings.deleteProvider({ provider_id: request.providerId });
      return result.status === 'failed'
        ? { status: 'failed', failure: toHostFailure(result.failure) }
        : { status: 'deleted', providerId: result.provider_id };
    },

    async setProviderApiKey(request) {
      const result = settings.writeProviderApiKey({
        provider_id: request.providerId,
        api_key: request.apiKey,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return readUpdatedProvider(settings, request.providerId);
    },

    async deleteProviderApiKey(request) {
      const result = settings.deleteProviderApiKey({ provider_id: request.providerId });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return readUpdatedProvider(settings, request.providerId);
    },

    async setVoiceTtsApiKey(request: VoiceTtsApiKeyUiRequest): Promise<VoiceTtsKeyUiResult> {
      const result = settings.writeVoiceTtsApiKey({ api_key: request.apiKey });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return readUpdatedVoiceTts(settings, 'updated');
    },

    async deleteVoiceTtsApiKey(): Promise<VoiceTtsKeyUiResult> {
      const result = settings.deleteVoiceTtsApiKey({});
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return readUpdatedVoiceTts(settings, 'deleted');
    },

    async getDiscoverySourceCredentialStatus(request): Promise<DiscoverySourceCredentialStatusUiResult> {
      const result = settings.getDiscoverySourceCredentialStatus({ source_id: request.sourceId });
      return result.status === 'failed'
        ? { status: 'failed', failure: toHostFailure(result.failure) }
        : { status: 'ok', sourceId: request.sourceId, configured: result.configured };
    },

    async setDiscoverySourceCredential(request): Promise<DiscoverySourceCredentialStatusUiResult> {
      const result = settings.writeDiscoverySourceCredential({
        source_id: request.sourceId,
        credential: request.credential,
      });
      return result.status === 'failed'
        ? { status: 'failed', failure: toHostFailure(result.failure) }
        : { status: 'ok', sourceId: request.sourceId, configured: true };
    },

    async deleteDiscoverySourceCredential(request): Promise<DiscoverySourceCredentialStatusUiResult> {
      const result = settings.deleteDiscoverySourceCredential({ source_id: request.sourceId });
      return result.status === 'failed'
        ? { status: 'failed', failure: toHostFailure(result.failure) }
        : { status: 'ok', sourceId: request.sourceId, configured: false };
    },
  };
}

function readUpdatedVoiceTts(settings: Settings, status: 'updated' | 'deleted'): VoiceTtsKeyUiResult {
  const resolved = settings.resolveVoiceTts();
  return resolved.status === 'ok'
    ? { status, tts: toVoiceTtsPublicUiDto(resolved.settings) }
    : { status: 'failed', failure: toHostFailure(resolved.failure) };
}

function resolveUpdatedSettings(
  settings: Settings,
): { status: 'updated'; settings: SettingsResolved } | SettingsFailureResult {
  const resolved = settings.resolve();
  return resolved.status === 'ok'
    ? { status: 'updated', settings: resolved.settings }
    : resolved;
}

function readUpdatedProvider(settings: Settings, providerId: string): EmptyUiResult {
  const provider = settings.getProvider({ provider_id: providerId });
  return provider.status === 'ok'
    ? { status: 'updated', provider: toProviderSettingsUiDto(provider.provider) }
    : { status: 'failed', failure: toHostFailure(provider.failure) };
}
