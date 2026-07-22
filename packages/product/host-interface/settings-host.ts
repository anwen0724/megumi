import type {
  SettingsRaw,
  SettingsResolved,
  SettingsService,
  SettingsThemeName,
  WebSearchPublicSettings,
} from '../../agent/settings';
import {
  PERMISSION_RULE_CATALOG,
  type PermissionActionId,
  type PermissionResourceType,
  type PermissionRule,
} from '../../agent/permissions';
import { z } from 'zod';

/*
 * Implements the SettingsHost interface over the Agent Settings module.
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

const PermissionEffectUiSchema = z.enum(['allow', 'ask', 'deny']);
const PermissionRuleUiSchema = z.object({
  effect: PermissionEffectUiSchema,
  source: z.enum(['user', 'workspace', 'session']),
  sourceId: z.string().min(1).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('operation'),
      action: z.enum(['workspace.read', 'workspace.write', 'process.execute', 'network.search', 'network.fetch', 'agent.context.activate', 'external.invoke']),
      resource: z.object({
        type: z.enum(['workspace.path', 'process.command', 'network.public_web', 'network.url', 'tool.identity']),
        operator: z.enum(['any', 'exact', 'prefix', 'glob', 'hostname']),
        value: z.string().min(1).optional(),
      }).strict().optional(),
    }).strict(),
    z.object({
      kind: z.literal('tool'), sourceId: z.string().min(1), namespace: z.string().min(1),
      sourceToolName: z.string().min(1), displayName: z.string().min(1).optional(),
    }).strict(),
  ]),
  reason: z.string().min(1).optional(),
}).strict();
const PermissionRuleChangeUiSchema = z.object({
  operation: z.enum(['add', 'remove']), rule: PermissionRuleUiSchema,
}).strict();

const ProviderSettingsUiPatchSchema = z.object({
  enabled: z.boolean().optional(), protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']).optional(),
  displayName: z.string().optional(), baseUrl: z.string().optional(), models: z.array(z.string()).optional(),
  apiKeyEnv: z.string().nullable().optional(),
}).strict();
export const SettingsGetPayloadSchema = z.object({}).strict();
export const SettingsUpdatePayloadSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']).optional(),
  setup: z.object({ completed: z.boolean().optional() }).strict().optional(),
  memory: z.object({ enabled: z.boolean().optional() }).strict().optional(),
  modelSelection: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }).strict().optional(),
  web: z.object({
    search: z.object({
      provider: z.enum(['brave', 'tavily', 'exa', 'custom']).optional(),
      apiKey: z.string().min(1).nullable().optional(),
      apiKeyEnv: z.string().min(1).nullable().optional(),
      baseUrl: z.string().url().nullable().optional(),
    }).strict().optional(),
  }).strict().optional(),
  providers: z.record(z.string(), ProviderSettingsUiPatchSchema).optional(),
  permissions: z.object({
    mode: z.enum(['ask', 'auto', 'full_access']).optional(),
    ruleChange: PermissionRuleChangeUiSchema.optional(),
  }).strict().optional(),
}).strict();
export const SettingsCompleteSetupPayloadSchema = z.object({
  language: z.enum(['zh-CN', 'en-US']).optional(),
  theme: z.enum(['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue']).optional(),
  provider: z.object({
    providerId: z.string().min(1),
    enabled: z.boolean().optional(),
    protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']).optional(),
    displayName: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
    modelIds: z.array(z.string().min(1)).optional(),
    apiKey: z.string().min(1).optional(),
    apiKeyEnv: z.string().min(1).nullable().optional(),
  }).strict().optional(),
}).strict();
export const ProviderListPayloadSchema = z.object({}).strict();
const ModelSupportLevelUiSchema = z.union([z.boolean(), z.literal('unknown')]);
const ModelCapabilitiesUiSchema = z.object({
  streaming: ModelSupportLevelUiSchema.optional(),
  toolCalls: ModelSupportLevelUiSchema.optional(),
  thinking: ModelSupportLevelUiSchema.optional(),
  imageInput: ModelSupportLevelUiSchema.optional(),
}).strict();
export const ProviderUpdatePayloadSchema = z.object({
  providerId: z.string().min(1), enabled: z.boolean().optional(), protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']).optional(),
  displayName: z.string().optional(), baseUrl: z.string().optional(), modelIds: z.array(z.string()).optional(),
  modelCapabilities: z.record(z.string(), ModelCapabilitiesUiSchema).optional(),
  models: z.array(z.object({
    modelId: z.string().min(1),
    displayName: z.string().min(1).optional(),
    contextWindowTokens: z.number().int().positive().optional(),
    imageInput: ModelSupportLevelUiSchema.optional(),
  }).strict()).optional(),
  apiKeyEnv: z.string().nullable().optional(),
}).strict();
export const ProviderDeletePayloadSchema = z.object({ providerId: z.string().min(1) }).strict();
export const ProviderApiKeyPayloadSchema = z.object({ providerId: z.string().min(1), apiKey: z.string().min(1) }).strict();
export const ProviderDeleteApiKeyPayloadSchema = ProviderDeletePayloadSchema;

const ProviderSettingsUiDtoSchema = z.object({
  enabled: z.boolean(),
  protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']),
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
  modelSelection: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }).strict().optional(),
  web: z.object({
    search: z.object({
      provider: z.enum(['brave', 'tavily', 'exa', 'custom']).optional(),
      baseUrl: z.string().url().optional(),
      hasApiKey: z.boolean(),
      credentialSource: z.enum(['settings', 'environment', 'missing']),
      apiKeyEnv: z.string().optional(),
    }).strict(),
  }).strict(),
  providers: z.record(z.string(), ProviderSettingsUiDtoSchema),
  permissions: z.object({
    mode: z.enum(['ask', 'auto', 'full_access']),
    rules: z.array(PermissionRuleUiSchema),
    catalog: z.object({
      operations: z.array(z.object({
        action: z.string().min(1), resourceType: z.string().min(1).optional(),
        operators: z.array(z.enum(['any', 'exact', 'prefix', 'glob', 'hostname'])),
      }).strict()),
      tools: z.array(z.object({
        sourceId: z.string().min(1), namespace: z.string().min(1), sourceToolName: z.string().min(1),
        registeredToolName: z.string().min(1), displayName: z.string().min(1),
      }).strict()),
    }).strict(),
  }).strict(),
}).strict();
const ProviderPublicStatusUiDtoSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string(),
  enabled: z.boolean(),
  protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']),
  baseUrl: z.string().optional(),
  modelIds: z.array(z.string()),
  modelSettings: z.record(z.string(), z.object({
    displayName: z.string().min(1),
    contextWindowTokens: z.number().int().positive(),
    capabilities: ModelCapabilitiesUiSchema.required(),
    capabilityOverrides: ModelCapabilitiesUiSchema,
  }).strict()).optional(),
  modelCapabilities: z.record(z.string(), ModelCapabilitiesUiSchema.required()).optional(),
  modelCapabilityOverrides: z.record(z.string(), ModelCapabilitiesUiSchema).optional(),
  apiKey: z.string().min(1).optional(),
  hasApiKey: z.boolean(),
  credentialSource: z.enum(['settings', 'environment', 'missing']),
  envOverrideActive: z.boolean(),
  apiKeyEnv: z.string().optional(),
  apiKeyEnvCustomized: z.boolean().optional(),
}).strict();
const ProviderCatalogUiDtoSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  protocol: z.enum(['openai-completions', 'openai-responses', 'openai-codex-responses', 'anthropic-messages', 'google-generative-ai']),
  defaultBaseUrl: z.string().url(),
  models: z.array(z.object({
    modelId: z.string().min(1),
    displayName: z.string().min(1),
    contextWindowTokens: z.number().int().positive(),
    capabilities: ModelCapabilitiesUiSchema.required(),
  }).strict()),
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
export const SettingsUpdateUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), settings: SettingsUiResolvedSchema }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const SettingsCompleteSetupUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), settings: SettingsUiResolvedSchema }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const ProviderListUiResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    providers: z.array(ProviderPublicStatusUiDtoSchema),
    catalog: z.array(ProviderCatalogUiDtoSchema),
  }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);
export const EmptyUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('updated'), provider: ProviderSettingsUiDtoSchema }).strict(),
  z.object({ status: z.literal('deleted'), providerId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: HostFailureSchema }).strict(),
]);

export function createSettingsHost(
  settingsService: Pick<
    SettingsService,
    | 'getResolvedSettings'
    | 'getWebSearchSettings'
    | 'updateSettings'
    | 'completeSetup'
    | 'listProviderSettings'
    | 'listProviderCatalog'
    | 'updateProviderSettings'
    | 'deleteProviderSettings'
    | 'setProviderApiKey'
    | 'clearProviderApiKey'
    | 'changePermissionRules'
  >,
  permissionOptions: {
    listAvailableTools?: () => Array<{
      identity: { sourceId: string; namespace: string; sourceToolName: string };
      registeredToolName: string;
      definition: { title?: string; name: string };
      source: { displayName: string };
    }>;
  } = {},
): SettingsHost {
  return {
    async get() {
      const result = settingsService.getResolvedSettings();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      const webSearch = settingsService.getWebSearchSettings();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      return { status: 'ok', settings: toSettingsUiResolved(result.settings, webSearch.settings, permissionOptions) };
    },
    async update(patch) {
      const rawPatch = toSettingsRawPatch(patch);
      let result = Object.keys(rawPatch).length > 0
        ? settingsService.updateSettings({ patch: rawPatch })
        : settingsService.getResolvedSettings();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      const ruleChange = patch.permissions?.ruleChange;
      if (ruleChange) {
        const rule = fromPermissionRuleUi(ruleChange.rule);
        const changed = settingsService.changePermissionRules({
          operation: ruleChange.operation, effect: ruleChange.rule.effect, rules: [rule],
          ...(rule.source === 'workspace' ? { workspace_id: rule.source_id } : {}),
          ...(rule.source === 'session' ? { session_id: rule.source_id } : {}),
        });
        if (changed.status === 'failed') return { status: 'failed', failure: toHostFailure(changed.failure) };
        result = { status: 'updated', settings: changed.settings };
      }
      const webSearch = settingsService.getWebSearchSettings();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      return { status: 'updated', settings: toSettingsUiResolved(result.settings, webSearch.settings, permissionOptions) };
    },
    async completeSetup(request) {
      const result = settingsService.completeSetup({
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
      const webSearch = settingsService.getWebSearchSettings();
      if (webSearch.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(webSearch.failure) };
      }
      return { status: 'completed', settings: toSettingsUiResolved(result.settings, webSearch.settings, permissionOptions) };
    },
    async listProviders() {
      const result = settingsService.listProviderSettings();
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      const catalog = settingsService.listProviderCatalog();
      return {
        status: 'ok',
        providers: result.providers.map(toProviderPublicStatusUiDto),
        catalog: catalog.providers.map(toProviderCatalogUiDto),
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
      const result = settingsService.updateProviderSettings({
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
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'updated', provider: toProviderSettingsUiDto(result.provider) };
    },
    async deleteProvider(request) {
      const result = settingsService.deleteProviderSettings({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'deleted', providerId: result.provider_id };
    },
    async setProviderApiKey(request) {
      const result = settingsService.setProviderApiKey({
        provider_id: request.providerId,
        api_key: request.apiKey,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'updated', provider: toProviderSettingsUiDto(result.provider) };
    },
    async deleteProviderApiKey(request) {
      const result = settingsService.clearProviderApiKey({
        provider_id: request.providerId,
      });
      if (result.status === 'failed') {
        return { status: 'failed', failure: toHostFailure(result.failure) };
      }
      return { status: 'updated', provider: toProviderSettingsUiDto(result.provider) };
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
  modelSelection?: {
    providerId: string;
    modelId: string;
  };
  web?: {
    search?: {
      provider?: 'brave' | 'tavily' | 'exa' | 'custom';
      apiKey?: string | null;
      apiKeyEnv?: string | null;
      baseUrl?: string | null;
    };
  };
  providers?: Record<string, ProviderSettingsUiPatch>;
  permissions?: { mode?: 'ask' | 'auto' | 'full_access'; ruleChange?: PermissionRuleChangeUi };
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
  modelSelection?: {
    providerId: string;
    modelId: string;
  };
  web: {
    search: {
      provider?: 'brave' | 'tavily' | 'exa' | 'custom';
      baseUrl?: string;
      hasApiKey: boolean;
      credentialSource: 'settings' | 'environment' | 'missing';
      apiKeyEnv?: string;
    };
  };
  providers: Record<string, ProviderSettingsUiDto>;
  permissions: {
    mode: 'ask' | 'auto' | 'full_access';
    rules: PermissionRuleUiDto[];
    catalog: PermissionRuleCatalogUiDto;
  };
};

export type PermissionRuleEffectUi = 'allow' | 'ask' | 'deny';
export type PermissionRuleUiDto = {
  effect: PermissionRuleEffectUi;
  source: 'user' | 'workspace' | 'session';
  sourceId?: string;
  target:
    | { kind: 'operation'; action: string; resource?: { type: string; operator: 'any' | 'exact' | 'prefix' | 'glob' | 'hostname'; value?: string } }
    | { kind: 'tool'; sourceId: string; namespace: string; sourceToolName: string; displayName?: string };
  reason?: string;
};
export type PermissionRuleChangeUi = { operation: 'add' | 'remove'; rule: PermissionRuleUiDto };
export type PermissionRuleCatalogUiDto = {
  operations: Array<{ action: string; resourceType?: string; operators: Array<'any' | 'exact' | 'prefix' | 'glob' | 'hostname'> }>;
  tools: Array<{ sourceId: string; namespace: string; sourceToolName: string; registeredToolName: string; displayName: string }>;
};

export type ProviderSettingsUiDto = {
  enabled: boolean;
  protocol: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
  displayName: string;
  baseUrl?: string;
  models: string[];
  apiKeyEnv?: string;
};

export type ProviderPublicStatusUiDto = {
  providerId: string;
  displayName: string;
  enabled: boolean;
  protocol: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
  baseUrl?: string;
  modelIds: string[];
  modelSettings?: Record<string, ProviderModelSettingsUiDto>;
  modelCapabilities?: Record<string, ModelCapabilitiesUiDto>;
  modelCapabilityOverrides?: Record<string, Partial<ModelCapabilitiesUiDto>>;
  apiKey?: string;
  hasApiKey: boolean;
  credentialSource: 'settings' | 'environment' | 'missing';
  envOverrideActive: boolean;
  apiKeyEnv?: string;
  apiKeyEnvCustomized?: boolean;
};

export type ProviderCatalogUiDto = {
  providerId: string;
  displayName: string;
  protocol: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
  defaultBaseUrl: string;
  models: Array<{
    modelId: string;
    displayName: string;
    contextWindowTokens: number;
    capabilities: ModelCapabilitiesUiDto;
  }>;
};

export type HostFailure = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type ProviderSettingsUiPatch = {
  enabled?: boolean;
  protocol?: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
  displayName?: string;
  baseUrl?: string;
  models?: string[];
  apiKeyEnv?: string | null;
};

export type ModelSupportLevelUi = boolean | 'unknown';
export type ModelCapabilitiesUiDto = {
  streaming: ModelSupportLevelUi;
  toolCalls: ModelSupportLevelUi;
  thinking: ModelSupportLevelUi;
  imageInput: ModelSupportLevelUi;
};

export type ProviderModelSettingsUiDto = {
  displayName: string;
  contextWindowTokens: number;
  capabilities: ModelCapabilitiesUiDto;
  capabilityOverrides: Partial<ModelCapabilitiesUiDto>;
};

export type SettingsCompleteSetupUiRequest = {
  language?: 'zh-CN' | 'en-US';
  theme?: SettingsUiThemeName;
  provider?: {
    providerId: string;
    enabled?: boolean;
    protocol?: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
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
export type SettingsUpdateUiResult =
  | { status: 'updated'; settings: SettingsUiResolved }
  | { status: 'failed'; failure: HostFailure };

export interface ProviderListUiRequest {}
export type ProviderListUiResult =
  | { status: 'ok'; providers: ProviderPublicStatusUiDto[]; catalog: ProviderCatalogUiDto[] }
  | { status: 'failed'; failure: HostFailure };

export interface ProviderUpdateUiRequest {
  providerId: string;
  enabled?: boolean;
  protocol?: 'openai-completions' | 'openai-responses' | 'openai-codex-responses' | 'anthropic-messages' | 'google-generative-ai';
  displayName?: string;
  baseUrl?: string;
  modelIds?: string[];
  modelCapabilities?: Record<string, Partial<ModelCapabilitiesUiDto>>;
  models?: Array<{
    modelId: string;
    displayName?: string;
    contextWindowTokens?: number;
    imageInput?: ModelSupportLevelUi;
  }>;
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
  | { status: 'updated'; provider: ProviderSettingsUiDto }
  | { status: 'deleted'; providerId: string }
  | { status: 'failed'; failure: HostFailure };

export type SettingsGetPayload = SettingsGetUiRequest;
export type SettingsUpdatePayload = SettingsUpdateUiRequest;
export type SettingsCompleteSetupPayload = SettingsCompleteSetupUiRequest;
export type SettingsData = SettingsGetUiResult;
export type SettingsCompleteSetupUiResult =
  | { status: 'completed'; settings: SettingsUiResolved }
  | { status: 'failed'; failure: HostFailure };

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
    ...(patch.modelSelection ? {
      model_selection: {
        provider_id: patch.modelSelection.providerId,
        model_id: patch.modelSelection.modelId,
      },
    } : {}),
    ...(patch.web?.search ? {
      web: {
        search: {
          ...(patch.web.search.provider ? { provider: patch.web.search.provider } : {}),
          ...(patch.web.search.apiKey !== undefined ? { api_key: patch.web.search.apiKey } : {}),
          ...(patch.web.search.apiKeyEnv !== undefined ? { api_key_env: patch.web.search.apiKeyEnv } : {}),
          ...(patch.web.search.baseUrl !== undefined ? { base_url: patch.web.search.baseUrl } : {}),
        },
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
          ...(provider.models !== undefined
            ? { models: Object.fromEntries(provider.models.map((modelId) => [modelId, {}])) }
            : {}),
          ...(provider.apiKeyEnv !== undefined ? { api_key_env: provider.apiKeyEnv } : {}),
        },
      ])),
    } : {}),
    ...(patch.permissions?.mode ? { permissions: { mode: patch.permissions.mode } } : {}),
  };
}

export function toSettingsUiResolved(
  settings: SettingsResolved,
  webSearch: WebSearchPublicSettings = { has_api_key: false, credential_source: 'missing' },
  permissionOptions: Parameters<typeof createSettingsHost>[1] = {},
): SettingsUiResolved {
  return {
    language: settings.language,
    theme: settings.theme,
    setup: {
      completed: settings.setup.completed,
      ...(settings.setup.completed_at ? { completedAt: settings.setup.completed_at } : {}),
    },
    memory: settings.memory,
    ...(settings.model_selection ? {
      modelSelection: {
        providerId: settings.model_selection.provider_id,
        modelId: settings.model_selection.model_id,
      },
    } : {}),
    web: {
      search: {
        ...(webSearch.provider ? { provider: webSearch.provider } : {}),
        ...(webSearch.base_url ? { baseUrl: webSearch.base_url } : {}),
        hasApiKey: webSearch.has_api_key,
        credentialSource: webSearch.credential_source,
        ...(webSearch.api_key_env ? { apiKeyEnv: webSearch.api_key_env } : {}),
      },
    },
    providers: Object.fromEntries(Object.entries(settings.providers).map(([providerId, provider]) => [
      providerId,
      {
        enabled: provider.enabled,
        protocol: provider.api,
        displayName: provider.display_name,
        ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
        models: Object.keys(provider.models),
        ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
      },
    ])),
    permissions: {
      mode: settings.permissions.mode,
      rules: (['allow', 'ask', 'deny'] as const).flatMap((effect) => (
        settings.permissions[effect].map((rule) => toPermissionRuleUi(effect, rule))
      )),
      catalog: {
        operations: PERMISSION_RULE_CATALOG.map((item) => ({
          action: item.action,
          ...('resource_type' in item ? { resourceType: item.resource_type } : {}),
          operators: [...item.operators],
        })),
        tools: (permissionOptions.listAvailableTools?.() ?? []).map((tool) => ({
          sourceId: tool.identity.sourceId,
          namespace: tool.identity.namespace,
          sourceToolName: tool.identity.sourceToolName,
          registeredToolName: tool.registeredToolName,
          displayName: tool.definition.title ?? tool.definition.name ?? tool.source.displayName,
        })),
      },
    },
  };
}

function toPermissionRuleUi(effect: PermissionRuleEffectUi, rule: PermissionRule): PermissionRuleUiDto {
  return {
    effect, source: rule.source, ...(rule.source_id ? { sourceId: rule.source_id } : {}),
    target: rule.target.kind === 'tool'
      ? {
          kind: 'tool', sourceId: rule.target.tool_identity.source_id,
          namespace: rule.target.tool_identity.namespace, sourceToolName: rule.target.tool_identity.source_tool_name,
        }
      : {
          kind: 'operation', action: rule.target.action,
          ...(rule.target.resource ? { resource: {
            type: rule.target.resource.type,
            operator: rule.target.resource.matcher.operator,
            ...('value' in rule.target.resource.matcher ? { value: rule.target.resource.matcher.value } : {}),
          } } : {}),
        },
    ...(rule.reason ? { reason: rule.reason } : {}),
  };
}

function fromPermissionRuleUi(rule: PermissionRuleUiDto): PermissionRule {
  return {
    source: rule.source, ...(rule.sourceId ? { source_id: rule.sourceId } : {}),
    target: rule.target.kind === 'tool'
      ? { kind: 'tool', tool_identity: {
          source_id: rule.target.sourceId, namespace: rule.target.namespace, source_tool_name: rule.target.sourceToolName,
        } }
      : { kind: 'operation', action: rule.target.action as PermissionActionId,
          ...(rule.target.resource ? { resource: {
            type: rule.target.resource.type as PermissionResourceType,
            matcher: rule.target.resource.operator === 'any'
              ? { operator: 'any' }
              : { operator: rule.target.resource.operator, value: rule.target.resource.value ?? '' },
          } } : {}),
        },
    ...(rule.reason ? { reason: rule.reason } : {}),
  } as PermissionRule;
}


export function toProviderPublicStatusUiDto(provider: {
  provider_id: string;
  display_name: string;
  enabled: boolean;
  api: ProviderPublicStatusUiDto['protocol'];
  base_url?: string;
  models: string[];
  model_settings: Record<string, {
    display_name: string;
    context_window_tokens: number;
    capabilities: ModelCapabilitiesUiDto;
  }>;
  model_capabilities: Record<string, ModelCapabilitiesUiDto>;
  model_capability_overrides: Record<string, Partial<ModelCapabilitiesUiDto>>;
  api_key?: string;
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
    protocol: provider.api,
    ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
    modelIds: provider.models,
    modelSettings: Object.fromEntries(Object.entries(provider.model_settings).map(([modelId, model]) => [
      modelId,
      {
        displayName: model.display_name,
        contextWindowTokens: model.context_window_tokens,
        capabilities: model.capabilities,
        capabilityOverrides: provider.model_capability_overrides[modelId] ?? {},
      },
    ])),
    modelCapabilities: provider.model_capabilities,
    modelCapabilityOverrides: provider.model_capability_overrides,
    ...(provider.api_key ? { apiKey: provider.api_key } : {}),
    hasApiKey: provider.has_api_key,
    credentialSource: provider.credential_source,
    envOverrideActive: provider.env_override_active,
    ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
    ...(provider.api_key_env_customized !== undefined ? { apiKeyEnvCustomized: provider.api_key_env_customized } : {}),
  };
}

export function toProviderCatalogUiDto(provider: {
  providerId: string;
  displayName: string;
  api: ProviderCatalogUiDto['protocol'];
  defaultBaseUrl: string;
  models: Array<{ modelId: string; displayName: string; contextWindowTokens: number; capabilities: ModelCapabilitiesUiDto }>;
}): ProviderCatalogUiDto {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    protocol: provider.api,
    defaultBaseUrl: provider.defaultBaseUrl,
    models: provider.models.map((model) => ({
      modelId: model.modelId,
      displayName: model.displayName,
      contextWindowTokens: model.contextWindowTokens,
      capabilities: model.capabilities,
    })),
  };
}

export function toProviderSettingsUiDto(provider: {
  enabled: boolean;
  api: ProviderSettingsUiDto['protocol'];
  display_name: string;
  base_url?: string;
  models: Record<string, { context_window_tokens: number }>;
  api_key_env?: string;
}): ProviderSettingsUiDto {
  return {
    enabled: provider.enabled,
    protocol: provider.api,
    displayName: provider.display_name,
    ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
    models: Object.keys(provider.models),
    ...(provider.api_key_env ? { apiKeyEnv: provider.api_key_env } : {}),
  };
}
