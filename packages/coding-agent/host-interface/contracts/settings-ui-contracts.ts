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
