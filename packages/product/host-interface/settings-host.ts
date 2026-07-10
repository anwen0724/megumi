import type {
  SettingsRaw,
  SettingsResolved,
  SettingsService,
  SettingsThemeName,
} from '../../coding-agent/settings';
import { z } from 'zod';

/*
 * Implements the SettingsHost interface over the Coding Agent Settings module.
 */

export interface SettingsHost {
  get(request?: SettingsGetUiRequest): Promise<SettingsGetUiResult>;
  update(request: SettingsUpdateUiRequest): Promise<SettingsUpdateUiResult>;
  completeSetup(request: SettingsCompleteSetupUiRequest): Promise<SettingsCompleteSetupUiResult>;
  listProviders(request?: ProviderListUiRequest): Promise<ProviderListUiResult>;
  updateProvider(request: ProviderUpdateUiRequest): Promise<EmptyUiResult>;
  deleteProvider(request: ProviderDeleteUiRequest): Promise<EmptyUiResult>;
  setProviderApiKey(request: ProviderSetApiKeyUiRequest): Promise<EmptyUiResult>;
  deleteProviderApiKey(request: ProviderDeleteApiKeyUiRequest): Promise<EmptyUiResult>;
}

const ProviderSettingsUiPatchSchema = z.object({
  enabled: z.boolean().optional(), protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
  displayName: z.string().optional(), baseUrl: z.string().optional(), models: z.array(z.string()).optional(),
  apiKeyEnv: z.string().nullable().optional(),
}).strict();
export const SettingsGetPayloadSchema = z.object({}).strict();
export const SettingsUpdatePayloadSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']).optional(),
  setup: z.object({ completed: z.boolean().optional() }).strict().optional(),
  memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  compaction: z.object({
    enabled: z.boolean().optional(), reserveTokens: z.number().int().nonnegative().optional(),
    keepRecentTokens: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  providers: z.record(z.string(), ProviderSettingsUiPatchSchema).optional(),
}).strict();
export const SettingsCompleteSetupPayloadSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']).optional(),
  provider: z.object({
    providerId: z.string().min(1),
    enabled: z.boolean().optional(),
    protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    modelIds: z.array(z.string().min(1)).optional(),
    apiKey: z.string().min(1).optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  }).strict().optional(),
}).strict();
export const ProviderListPayloadSchema = z.object({}).strict();
export const ProviderUpdatePayloadSchema = z.object({
  providerId: z.string().min(1), enabled: z.boolean().optional(), protocol: z.enum(['openai-compatible', 'anthropic']).optional(),
  displayName: z.string().optional(), baseUrl: z.string().optional(), modelIds: z.array(z.string()).optional(),
  apiKeyEnv: z.string().nullable().optional(),
}).strict();
export const ProviderDeletePayloadSchema = z.object({ providerId: z.string().min(1) }).strict();
export const ProviderApiKeyPayloadSchema = z.object({ providerId: z.string().min(1), apiKey: z.string().min(1) }).strict();
export const ProviderDeleteApiKeyPayloadSchema = ProviderDeletePayloadSchema;

const ProviderSettingsUiDtoSchema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(['openai-compatible', 'anthropic']),
  displayName: z.string(),
  baseUrl: z.string().optional(),
  models: z.array(z.string()),
  apiKeyEnv: z.string().optional(),
}).strict();
const SettingsUiResolvedSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']),
  theme: z.enum(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']),
  setup: z.object({ completed: z.boolean(), completedAt: z.string().datetime().optional() }).strict(),
  memory: z.object({ enabled: z.boolean() }).strict(),
  compaction: z.object({
    enabled: z.boolean(), reserveTokens: z.number().int().nonnegative(), keepRecentTokens: z.number().int().nonnegative(),
  }).strict(),
  providers: z.record(z.string(), ProviderSettingsUiDtoSchema),
}).strict();
const ProviderPublicStatusUiDtoSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string(),
  enabled: z.boolean(),
  protocol: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().optional(),
  modelIds: z.array(z.string()),
  hasApiKey: z.boolean(),
  credentialSource: z.enum(['settings', 'environment', 'missing']),
  envOverrideActive: z.boolean(),
  apiKeyEnv: z.string().optional(),
  apiKeyEnvCustomized: z.boolean().optional(),
}).strict();

const HostFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean().optional(),
}).strict();

export const SettingsGetUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), settings: SettingsUiResolvedSchema }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const SettingsUpdateUiResultSchema = SettingsGetUiResultSchema;
export const SettingsCompleteSetupUiResultSchema = SettingsGetUiResultSchema;
export const ProviderListUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), providers: z.array(ProviderPublicStatusUiDtoSchema) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const EmptyUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);

export function createSettingsHost(
  settingsService: Pick<
    SettingsService,
    | 'getResolvedSettings'
    | 'updateSettings'
    | 'completeSetup'
    | 'listProviderSettings'
    | 'updateProviderSettings'
    | 'deleteProviderSettings'
    | 'setProviderApiKey'
    | 'clearProviderApiKey'
  >,
): SettingsHost {
  return {
    async get() {
      const result = settingsService.getResolvedSettings();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok', settings: toSettingsUiResolved(result.settings) };
    },
    async update(patch) {
      const result = settingsService.updateSettings({ patch: toSettingsRawPatch(patch) });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok', settings: toSettingsUiResolved(result.settings) };
    },
    async completeSetup(request) {
      const result = settingsService.completeSetup({
        ...(request.language ? { language: request.language } : {}),
        ...(request.theme ? { theme: request.theme as SettingsThemeName } : {}),
        ...(request.provider ? {
          provider: {
            provider_id: request.provider.providerId,
            ...(request.provider.enabled !== undefined ? { enabled: request.provider.enabled } : {}),
            ...(request.provider.protocol ? { protocol: request.provider.protocol } : {}),
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
      return { status: 'ok', settings: toSettingsUiResolved(result.settings) };
    },
    async listProviders() {
      const result = settingsService.listProviderSettings();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok', providers: result.providers.map(toProviderPublicStatusUiDto) };
    },
    async updateProvider({ providerId, ...input }) {
      const result = settingsService.updateProviderSettings({
        provider_id: providerId,
        patch: {
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
          ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
          ...(input.baseUrl !== undefined ? { base_url: input.baseUrl } : {}),
          ...(input.modelIds !== undefined ? { models: input.modelIds } : {}),
          ...(input.apiKeyEnv !== undefined ? { api_key_env: input.apiKeyEnv } : {}),
        },
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok' };
    },
    async deleteProvider(request) {
      const result = settingsService.deleteProviderSettings({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok' };
    },
    async setProviderApiKey(request) {
      const result = settingsService.setProviderApiKey({
        provider_id: request.providerId,
        api_key: request.apiKey,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok' };
    },
    async deleteProviderApiKey(request) {
      const result = settingsService.clearProviderApiKey({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'ok' };
    },
  };
}

function toHostFailure(failure: { code?: string; message: string; retryable?: boolean }): HostFailure {
  return {
    code: failure.code ?? 'settings_failed',
    message: failure.message,
    ...(failure.retryable !== undefined ? { retryable: failure.retryable } : {}),
  };
}

/*
 * Settings and provider UI DTOs exposed by the host interface.
 */
export type SettingsUiRaw = {
  language?: 'zh-CN' | 'en-US';
  theme?: SettingsUiThemeName;
  setup?: {
    completed?: boolean;
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

export type HostFailure = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ProviderSettingsUiPatch = {
  enabled?: boolean;
  protocol?: 'openai-compatible' | 'anthropic';
  displayName?: string;
  baseUrl?: string;
  models?: string[];
  apiKeyEnv?: string | null;
};

export type SettingsCompleteSetupUiRequest = {
  language?: 'zh-CN' | 'en-US';
  theme?: SettingsUiThemeName;
  provider?: {
    providerId: string;
    enabled?: boolean;
    protocol?: 'openai-compatible' | 'anthropic';
    displayName?: string;
    baseUrl?: string;
    modelIds?: string[];
    apiKey?: string;
    apiKeyEnv?: string | null;
  };
};

export interface SettingsGetUiRequest {}
export type SettingsGetUiResult =
  | { status: 'ok'; settings: SettingsUiResolved }
  | { status: 'failed'; failure: HostFailure };

export type SettingsUpdateUiRequest = SettingsUiRaw;
export type SettingsUpdateUiResult = SettingsGetUiResult;

export interface ProviderListUiRequest {}
export type ProviderListUiResult =
  | { status: 'ok'; providers: ProviderPublicStatusUiDto[] }
  | { status: 'failed'; failure: HostFailure };

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

export type EmptyUiResult =
  | { status: 'ok' }
  | { status: 'failed'; failure: HostFailure };

export type SettingsGetPayload = SettingsGetUiRequest;
export type SettingsUpdatePayload = SettingsUpdateUiRequest;
export type SettingsCompleteSetupPayload = SettingsCompleteSetupUiRequest;
export type SettingsData = SettingsGetUiResult;
export type SettingsCompleteSetupUiResult = SettingsGetUiResult;

/*
 * Maps Settings module facts into host-facing settings UI DTOs.
 */


export function toSettingsRawPatch(patch: SettingsUiRaw): SettingsRaw {
  return {
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.theme ? { theme: patch.theme as SettingsThemeName } : {}),
    ...(patch.setup ? {
      setup: {
        ...(patch.setup.completed !== undefined ? { completed: patch.setup.completed } : {}),
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
          ...(provider.protocol !== undefined ? { protocol: provider.protocol } : {}),
          ...(provider.displayName !== undefined ? { display_name: provider.displayName } : {}),
          ...(provider.baseUrl !== undefined ? { base_url: provider.baseUrl } : {}),
          ...(provider.models !== undefined ? { models: provider.models } : {}),
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
