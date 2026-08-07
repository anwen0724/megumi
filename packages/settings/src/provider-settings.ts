/* Defines Provider settings and projects model facts owned by @megumi/ai. */
import { z } from 'zod';
import type { SettingsEnvironment } from './settings-environment';
import {
  ModelCapabilitiesSchema,
  ResolvedModelCapabilitiesSchema,
  UNKNOWN_MODEL_CAPABILITIES,
  capabilitiesFromModel,
  type ResolvedModelCapabilities,
} from './model-capability';
import { builtinProviders } from '@megumi/ai/providers/all';
import type {
  ReadApiKeyResult,
  SettingsFailureResult,
} from './settings-schema';

export const ProviderIdSchema = z.string().min(1);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ProviderApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'anthropic-messages',
  'google-generative-ai',
]);
export type ProviderApi = z.infer<typeof ProviderApiSchema>;

export const ProviderModelSettingsRawSchema = z.object({
  display_name: z.string().min(1).optional(),
  context_window_tokens: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  capabilities: ModelCapabilitiesSchema.optional(),
}).strict();
export type ProviderModelSettingsRaw = z.infer<typeof ProviderModelSettingsRawSchema>;

export const ProviderModelSettingsResolvedSchema = z.object({
  display_name: z.string().min(1),
  context_window_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  capabilities: ResolvedModelCapabilitiesSchema,
}).strict();
export type ProviderModelSettingsResolved = z.infer<typeof ProviderModelSettingsResolvedSchema>;

export const ProviderSettingsRawSchema = z.object({
  enabled: z.boolean().optional(),
  api: ProviderApiSchema.optional(),
  display_name: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  models: z.record(z.string().min(1), ProviderModelSettingsRawSchema).optional(),
  api_key_env: z.string().min(1).nullable().optional(),
}).strict();
export type ProviderSettingsRaw = z.infer<typeof ProviderSettingsRawSchema>;

// This schema is internal to Settings persistence and is intentionally absent
// from the Package entrypoint. Provider files may carry user-added fields.
export const ProviderSettingsFileRawSchema = ProviderSettingsRawSchema.extend({
  api_key: z.string().min(1).nullable().optional(),
}).passthrough();
export type ProviderSettingsFileRaw = z.infer<typeof ProviderSettingsFileRawSchema>;

export const ProviderSettingsResolvedSchema = z.object({
  enabled: z.boolean(),
  api: ProviderApiSchema,
  display_name: z.string().min(1),
  base_url: z.string().url().optional(),
  models: z.record(z.string().min(1), ProviderModelSettingsResolvedSchema),
  api_key_env: z.string().min(1).optional(),
}).strict();
export type ProviderSettingsResolved = z.infer<typeof ProviderSettingsResolvedSchema>;

export const ProviderCredentialSourceSchema = z.enum(['settings', 'environment', 'missing']);
export type ProviderCredentialSource = z.infer<typeof ProviderCredentialSourceSchema>;

export const ProviderPublicStatusSchema = z.object({
  provider_id: ProviderIdSchema,
  display_name: z.string().min(1),
  enabled: z.boolean(),
  api: ProviderApiSchema,
  base_url: z.string().url().optional(),
  models: z.array(z.string().min(1)),
  model_settings: z.record(z.string().min(1), ProviderModelSettingsResolvedSchema),
  model_capabilities: z.record(z.string().min(1), ResolvedModelCapabilitiesSchema),
  model_capability_overrides: z.record(z.string().min(1), ModelCapabilitiesSchema),
  has_api_key: z.boolean(),
  credential_source: ProviderCredentialSourceSchema,
  env_override_active: z.boolean(),
  api_key_env: z.string().min(1).optional(),
  api_key_env_customized: z.boolean().optional(),
}).strict();
export type ProviderPublicStatus = z.infer<typeof ProviderPublicStatusSchema>;

export const AvailableModelOptionSchema = z.object({
  provider_id: ProviderIdSchema,
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  capabilities: ResolvedModelCapabilitiesSchema,
}).strict();
export type AvailableModelOption = z.infer<typeof AvailableModelOptionSchema>;

export const ResolveProviderSettingsRequestSchema = z.object({
  provider_id: ProviderIdSchema,
  model_id: z.string().min(1),
}).strict();
export type ResolveProviderSettingsRequest = z.infer<typeof ResolveProviderSettingsRequestSchema>;

export const ResolvedProviderSettingsSchema = z.object({
  provider_id: ProviderIdSchema,
  api: ProviderApiSchema,
  base_url: z.string().url(),
  model_id: z.string().min(1),
  display_name: z.string().min(1),
  context_window_tokens: z.number().int().positive(),
  max_output_tokens: z.number().int().positive(),
  capabilities: ResolvedModelCapabilitiesSchema,
}).strict();
export type ResolvedProviderSettings = z.infer<typeof ResolvedProviderSettingsSchema>;
export type ResolveProviderSettingsResult =
  | { status: 'ok'; config: ResolvedProviderSettings }
  | SettingsFailureResult;

export const GetProviderSettingsRequestSchema = z.object({
  provider_id: ProviderIdSchema,
}).strict();
export type GetProviderSettingsRequest = z.infer<typeof GetProviderSettingsRequestSchema>;
export type GetProviderSettingsResult =
  | { status: 'ok'; provider: ProviderSettingsResolved }
  | SettingsFailureResult;

export const UpdateProviderSettingsRequestSchema = z.object({
  provider_id: ProviderIdSchema,
  patch: ProviderSettingsRawSchema,
}).strict();
export type UpdateProviderSettingsRequest = z.infer<typeof UpdateProviderSettingsRequestSchema>;
export type UpdateProviderSettingsResult =
  | { status: 'updated'; provider: ProviderSettingsResolved }
  | SettingsFailureResult;

export const DeleteProviderSettingsRequestSchema = z.object({
  provider_id: ProviderIdSchema,
}).strict();
export type DeleteProviderSettingsRequest = z.infer<typeof DeleteProviderSettingsRequestSchema>;
export type DeleteProviderSettingsResult =
  | { status: 'deleted'; provider_id: ProviderId }
  | SettingsFailureResult;

export const ReadProviderApiKeyRequestSchema = z.object({
  provider_id: ProviderIdSchema,
}).strict();
export type ReadProviderApiKeyRequest = z.infer<typeof ReadProviderApiKeyRequestSchema>;

export const WriteProviderApiKeyRequestSchema = z.object({
  provider_id: ProviderIdSchema,
  api_key: z.string().min(1),
}).strict();
export type WriteProviderApiKeyRequest = z.infer<typeof WriteProviderApiKeyRequestSchema>;

export const DeleteProviderApiKeyRequestSchema = z.object({
  provider_id: ProviderIdSchema,
}).strict();
export type DeleteProviderApiKeyRequest = z.infer<typeof DeleteProviderApiKeyRequestSchema>;

export type ProviderCatalogDefinition = {
  providerId: string;
  displayName: string;
  api: ProviderApi;
  defaultBaseUrl: string;
  models: Array<{
    modelId: string;
    displayName: string;
    contextWindowTokens: number;
    maxOutputTokens: number;
    capabilities: ResolvedModelCapabilities;
  }>;
};

export type ListProviderSettingsResult =
  | { status: 'ok'; providers: ProviderPublicStatus[] }
  | SettingsFailureResult;
export type ListAvailableModelsResult =
  | { status: 'ok'; models: AvailableModelOption[] }
  | SettingsFailureResult;

const providers = builtinProviders();
export const DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW_TOKENS = 256_000;

export function listProviderCatalog(): ProviderCatalogDefinition[] {
  return providers.flatMap((provider) => {
    if (!provider.baseUrl) return [];
    const models = provider.getModels().flatMap((model) => {
      const api = knownApi(model.api);
      return api ? [{ model, api }] : [];
    });
    const api = models[0]?.api;
    if (!api) return [];
    return [{
      providerId: provider.id,
      displayName: provider.name,
      api,
      defaultBaseUrl: provider.baseUrl,
      models: models.map(({ model }) => ({
        modelId: model.id,
        displayName: model.name,
        contextWindowTokens: model.contextWindow,
        maxOutputTokens: model.maxTokens,
        capabilities: capabilitiesFromModel(model),
      })),
    }];
  });
}

export function resolveProviderSettings(
  providerId: string,
  raw: ProviderSettingsRaw,
): ProviderSettingsResolved {
  const definition = providerCatalog(providerId);
  const models: Record<string, ProviderModelSettingsRaw> = raw.models ?? Object.fromEntries(
    definition?.models.map((model) => [model.modelId, {}]) ?? [],
  );
  return ProviderSettingsResolvedSchema.parse({
    enabled: raw.enabled ?? true,
    api: raw.api ?? definition?.api ?? 'openai-completions',
    display_name: raw.display_name ?? definition?.displayName ?? providerId,
    ...(raw.base_url ?? definition?.defaultBaseUrl
      ? { base_url: raw.base_url ?? definition?.defaultBaseUrl }
      : {}),
    models: Object.fromEntries(Object.entries(models).map(([modelId, model]) => {
      const known = modelCatalog(providerId, modelId);
      return [modelId, {
        display_name: model.display_name ?? known?.displayName ?? modelId,
        context_window_tokens: known
          ? Math.min(model.context_window_tokens ?? known.contextWindowTokens, known.contextWindowTokens)
          : model.context_window_tokens ?? DEFAULT_UNKNOWN_MODEL_CONTEXT_WINDOW_TOKENS,
        max_output_tokens: known
          ? Math.min(model.max_output_tokens ?? known.maxOutputTokens, known.maxOutputTokens)
          : model.max_output_tokens ?? 8_192,
        capabilities: {
          ...(known?.capabilities ?? UNKNOWN_MODEL_CAPABILITIES),
          ...(model.capabilities ?? {}),
        },
      }];
    })),
    ...(raw.api_key_env ? { api_key_env: raw.api_key_env } : {}),
  });
}

export function materializeProviderSettings(
  providerId: string,
  raw: ProviderSettingsRaw,
): ProviderSettingsRaw {
  const resolved = resolveProviderSettings(providerId, raw);
  return ProviderSettingsRawSchema.parse({
    enabled: resolved.enabled,
    api: resolved.api,
    display_name: resolved.display_name,
    ...(resolved.base_url ? { base_url: resolved.base_url } : {}),
    models: Object.fromEntries(Object.entries(resolved.models).map(([modelId, model]) => [
      modelId,
      {
        ...(raw.models?.[modelId]?.display_name ? { display_name: raw.models[modelId].display_name } : {}),
        context_window_tokens: model.context_window_tokens,
        max_output_tokens: model.max_output_tokens,
        ...(raw.models?.[modelId]?.capabilities
          ? { capabilities: raw.models[modelId].capabilities }
          : {}),
      },
    ])),
    ...(resolved.api_key_env ? { api_key_env: resolved.api_key_env } : {}),
  });
}

export function listProviderStatuses(
  resolvedProviders: Record<string, ProviderSettingsResolved>,
  rawProviders: Record<string, ProviderSettingsRaw>,
  fileProviders: Record<string, ProviderSettingsFileRaw>,
  environment: SettingsEnvironment,
): ProviderPublicStatus[] {
  return Object.entries(resolvedProviders).map(([providerId, provider]) => {
    const credential = readProviderApiKey(fileProviders[providerId], environment);
    const envOverrideActive = Boolean(
      provider.api_key_env && environment.readVariable(provider.api_key_env)?.trim(),
    );
    return ProviderPublicStatusSchema.parse({
      provider_id: providerId,
      display_name: provider.display_name,
      enabled: provider.enabled,
      api: provider.api,
      ...(provider.base_url ? { base_url: provider.base_url } : {}),
      models: Object.keys(provider.models),
      model_settings: provider.models,
      model_capabilities: Object.fromEntries(
        Object.entries(provider.models).map(([modelId, model]) => [modelId, model.capabilities]),
      ),
      model_capability_overrides: Object.fromEntries(
        Object.keys(provider.models).map((modelId) => [
          modelId,
          rawProviders[providerId]?.models?.[modelId]?.capabilities ?? {},
        ]),
      ),
      has_api_key: credential.status === 'found',
      credential_source: credential.status === 'found' ? credential.source : 'missing',
      env_override_active: envOverrideActive,
      ...(provider.api_key_env ? { api_key_env: provider.api_key_env } : {}),
    });
  });
}

export function listAvailableModels(
  providersById: Record<string, ProviderSettingsResolved>,
): AvailableModelOption[] {
  return Object.entries(providersById).flatMap(([providerId, provider]) => (
    provider.enabled
      ? Object.entries(provider.models).map(([modelId, model]) => ({
          provider_id: providerId,
          model_id: modelId,
          display_name: model.display_name,
          capabilities: model.capabilities,
        }))
      : []
  ));
}

export function resolveProviderConfig(
  providersById: Record<string, ProviderSettingsResolved>,
  request: ResolveProviderSettingsRequest,
): { status: 'ok'; config: ResolvedProviderSettings } | { status: 'error'; settingsCode: string; message: string } {
  const provider = providersById[request.provider_id];
  if (!provider) return domainError('provider_unknown', 'Provider settings were not found.');
  if (!provider.enabled) return domainError('provider_disabled', 'Provider is disabled.');
  const model = provider.models[request.model_id];
  if (!model) return domainError('provider_model_unknown', 'Provider model is not configured.');
  if (!provider.base_url) return domainError('provider_config_invalid', 'Provider base URL is required.');
  return {
    status: 'ok',
    config: ResolvedProviderSettingsSchema.parse({
      provider_id: request.provider_id,
      api: provider.api,
      base_url: provider.base_url,
      model_id: request.model_id,
      display_name: model.display_name,
      context_window_tokens: model.context_window_tokens,
      max_output_tokens: model.max_output_tokens,
      capabilities: model.capabilities,
    }),
  };
}

export function readProviderApiKey(
  provider: ProviderSettingsFileRaw | undefined,
  environment: SettingsEnvironment,
): ReadApiKeyResult {
  const direct = provider?.api_key?.trim();
  if (direct) return { status: 'found', api_key: direct, source: 'settings' };
  const envName = provider?.api_key_env ?? undefined;
  const fromEnv = envName ? environment.readVariable(envName)?.trim() : undefined;
  return fromEnv
    ? { status: 'found', api_key: fromEnv, source: 'environment', env_name: envName }
    : { status: 'missing' };
}

function providerCatalog(providerId: string): ProviderCatalogDefinition | undefined {
  return listProviderCatalog().find((provider) => provider.providerId === providerId);
}

function modelCatalog(providerId: string, modelId: string) {
  return providerCatalog(providerId)?.models.find((model) => model.modelId === modelId);
}

function knownApi(value: string): ProviderApi | undefined {
  const parsed = ProviderApiSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function domainError(settingsCode: string, message: string) {
  return { status: 'error' as const, settingsCode, message };
}
