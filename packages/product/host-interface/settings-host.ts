import type {
  SettingsRaw,
  SettingsResolved,
  SettingsService,
  SettingsThemeName,
} from '../../coding-agent/settings';

/*
 * Implements the SettingsHost interface over the Coding Agent Settings module.
 */

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

/*
 * Settings and provider UI DTOs exposed by the host interface.
 */
export type SettingsUiRaw = {
  language?: 'zh-CN' | 'en-US';
  theme?: SettingsUiThemeName;
  setup?: {
    completed?: boolean;
    completedAt?: string;
  };
  memory?: {
    enabled?: boolean;
  };
  compaction?: {
    enabled?: boolean;
    reserveTokens?: number;
    keepRecentTokens?: number;
  };
  providers?: Record<string, ProviderSettingsUiPatch>;
};

export type SettingsUiThemeName =
  | 'megumi-warm'
  | 'neutral-light'
  | 'graphite-dark'
  | 'sage-mist'
  | 'midnight-blue';
export type AppLanguage = 'zh-CN' | 'en-US';
export type AppThemeName = SettingsUiThemeName;

export type SettingsUiResolved = {
  language: 'zh-CN' | 'en-US';
  theme: SettingsUiThemeName;
  setup: {
    completed: boolean;
    completedAt?: string;
  };
  memory: {
    enabled: boolean;
  };
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  };
  providers: Record<string, ProviderSettingsUiDto>;
};

export type ProviderSettingsUiDto = {
  enabled: boolean;
  protocol: 'openai-compatible' | 'anthropic';
  displayName: string;
  baseUrl?: string;
  models: string[];
  apiKeyEnv?: string;
};

export type ProviderPublicStatusUiDto = {
  providerId: string;
  displayName: string;
  enabled: boolean;
  protocol: 'openai-compatible' | 'anthropic';
  baseUrl?: string;
  modelIds: string[];
  hasApiKey: boolean;
  credentialSource: 'settings' | 'environment' | 'missing';
  envOverrideActive: boolean;
  apiKeyEnv?: string;
  apiKeyEnvCustomized?: boolean;
};

export type ProviderSettingsUiPatch = {
  enabled?: boolean;
  protocol?: 'openai-compatible' | 'anthropic';
  displayName?: string;
  baseUrl?: string;
  models?: string[];
  apiKey?: string | null;
  apiKeyEnv?: string | null;
};

export interface SettingsGetUiRequest {}
export interface SettingsGetUiResult {
  settings: SettingsUiResolved;
}

export type SettingsUpdateUiRequest = SettingsUiRaw;
export interface SettingsUpdateUiResult {
  settings: SettingsUiResolved;
}

export interface ProviderListUiRequest {}
export interface ProviderListUiResult {
  providers: ProviderPublicStatusUiDto[];
}

export interface ProviderUpdateUiRequest {
  providerId: string;
  enabled?: boolean;
  protocol?: 'openai-compatible' | 'anthropic';
  displayName?: string;
  baseUrl?: string;
  modelIds?: string[];
  apiKeyEnv?: string | null;
}

export interface ProviderSetApiKeyUiRequest {
  providerId: string;
  apiKey: string;
}

export interface ProviderDeleteApiKeyUiRequest {
  providerId: string;
}

export interface ProviderDeleteUiRequest {
  providerId: string;
}

export interface EmptyUiResult {}

export type SettingsGetPayload = SettingsGetUiRequest;
export type SettingsUpdatePayload = SettingsUpdateUiRequest;
export type SettingsData = SettingsGetUiResult;

export const DEFAULT_APP_SETTINGS: SettingsUiResolved = {
  language: 'zh-CN',
  theme: 'midnight-blue',
  setup: {
    completed: false,
  },
  memory: {
    enabled: false,
  },
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
  providers: {},
};

/*
 * Maps Settings module facts into host-facing settings UI DTOs.
 */


export function toSettingsRawPatch(patch: SettingsUiRaw): SettingsRaw {
  return {
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.theme ? { theme: patch.theme as SettingsThemeName } : {}),
    ...(patch.setup ? {
      setup: {
        ...(patch.setup.completed !== undefined ? { completed_at: patch.setup.completedAt, completed: patch.setup.completed } : {}),
        ...(patch.setup.completedAt ? { completed_at: patch.setup.completedAt } : {}),
      },
    } : {}),
    ...(patch.memory ? { memory: patch.memory } : {}),
    ...(patch.compaction ? {
      compaction: {
        ...(patch.compaction.enabled !== undefined ? { enabled: patch.compaction.enabled } : {}),
        ...(patch.compaction.reserveTokens !== undefined ? { reserve_tokens: patch.compaction.reserveTokens } : {}),
        ...(patch.compaction.keepRecentTokens !== undefined ? { keep_recent_tokens: patch.compaction.keepRecentTokens } : {}),
      },
    } : {}),
    ...(patch.providers ? {
      providers: Object.fromEntries(Object.entries(patch.providers).map(([providerId, provider]) => [
        providerId,
        {
          ...(provider.enabled !== undefined ? { enabled: provider.enabled } : {}),
          ...(provider.protocol ? { protocol: provider.protocol } : {}),
          ...(provider.displayName ? { display_name: provider.displayName } : {}),
          ...(provider.baseUrl ? { base_url: provider.baseUrl } : {}),
          ...(provider.models ? { models: provider.models } : {}),
          ...(provider.apiKey !== undefined ? { api_key: provider.apiKey } : {}),
          ...(provider.apiKeyEnv !== undefined ? { api_key_env: provider.apiKeyEnv } : {}),
        },
      ])),
    } : {}),
  };
}

export function toSettingsUiResolved(settings: SettingsResolved): SettingsUiResolved {
  return {
    language: settings.language,
    theme: settings.theme,
    setup: {
      completed: settings.setup.completed,
      ...(settings.setup.completed_at ? { completedAt: settings.setup.completed_at } : {}),
    },
    memory: settings.memory,
    compaction: {
      enabled: settings.compaction.enabled,
      reserveTokens: settings.compaction.reserve_tokens,
      keepRecentTokens: settings.compaction.keep_recent_tokens,
    },
    providers: Object.fromEntries(Object.entries(settings.providers).map(([providerId, provider]) => [
      providerId,
      {
        enabled: provider.enabled,
        protocol: provider.protocol,
        displayName: provider.display_name,
        ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
        models: provider.models,
        ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
      },
    ])),
  };
}

export function toProviderPublicStatusUiDto(provider: {
  provider_id: string;
  display_name: string;
  enabled: boolean;
  protocol: ProviderPublicStatusUiDto['protocol'];
  base_url?: string;
  models: string[];
  has_api_key: boolean;
  credential_source: ProviderPublicStatusUiDto['credentialSource'];
  env_override_active: boolean;
  api_key_env?: string;
  api_key_env_customized?: boolean;
}): ProviderPublicStatusUiDto {
  return {
    providerId: provider.provider_id,
    displayName: provider.display_name,
    enabled: provider.enabled,
    protocol: provider.protocol,
    ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
    modelIds: provider.models,
    hasApiKey: provider.has_api_key,
    credentialSource: provider.credential_source,
    envOverrideActive: provider.env_override_active,
    ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
    ...(provider.api_key_env_customized !== undefined ? { apiKeyEnvCustomized: provider.api_key_env_customized } : {}),
  };
}
