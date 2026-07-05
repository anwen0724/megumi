/*
 * Defines Settings-owned provider instance configuration and runtime resolution contracts.
 * A provider instance is user-configured; protocol selects the AI package request adapter.
 */
import { z } from 'zod';
import type { SettingsError } from './settings-contracts';

export const ProviderIdSchema = z.string().min(1);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const ProviderProtocolSchema = z.enum(['openai-compatible', 'anthropic']);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

export const ProviderSettingsRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    protocol: ProviderProtocolSchema.optional(),
    display_name: z.string().min(1).optional(),
    base_url: z.string().url().optional(),
    models: z.array(z.string().min(1)).optional(),
    api_key: z.string().min(1).nullable().optional(),
    api_key_env: z.string().min(1).nullable().optional(),
  })
  .strict();
export type ProviderSettingsRaw = z.infer<typeof ProviderSettingsRawSchema>;

export const ProviderSettingsResolvedSchema = z
  .object({
    enabled: z.boolean(),
    protocol: ProviderProtocolSchema,
    display_name: z.string().min(1),
    base_url: z.string().url().optional(),
    models: z.array(z.string().min(1)),
    api_key: z.string().min(1).optional(),
    api_key_env: z.string().min(1).optional(),
  })
  .strict();
export type ProviderSettingsResolved = z.infer<typeof ProviderSettingsResolvedSchema>;

export const ProviderCredentialSourceSchema = z.enum(['settings', 'environment', 'missing']);
export type ProviderCredentialSource = z.infer<typeof ProviderCredentialSourceSchema>;

export const ProviderPublicStatusSchema = z
  .object({
    provider_id: ProviderIdSchema,
    display_name: z.string().min(1),
    enabled: z.boolean(),
    base_url: z.string().url().optional(),
    models: z.array(z.string().min(1)),
    has_api_key: z.boolean(),
    credential_source: ProviderCredentialSourceSchema,
    env_override_active: z.boolean(),
    api_key_env: z.string().min(1).optional(),
    api_key_env_customized: z.boolean().optional(),
  })
  .strict();
export type ProviderPublicStatus = z.infer<typeof ProviderPublicStatusSchema>;

export const AvailableModelOptionSchema = z
  .object({
    provider_id: ProviderIdSchema,
    model_id: z.string().min(1),
    display_name: z.string().min(1),
  })
  .strict();
export type AvailableModelOption = z.infer<typeof AvailableModelOptionSchema>;

export const ProviderRuntimeConfigSchema = z
  .object({
    provider_id: ProviderIdSchema,
    protocol: ProviderProtocolSchema,
    base_url: z.string().url().optional(),
    model_id: z.string().min(1),
    api_key: z.string().min(1).optional(),
  })
  .strict();
export type ProviderRuntimeConfig = z.infer<typeof ProviderRuntimeConfigSchema>;

export const GetProviderSettingsRequestSchema = z
  .object({
    provider_id: ProviderIdSchema,
  })
  .strict();
export type GetProviderSettingsRequest = z.infer<typeof GetProviderSettingsRequestSchema>;

export type GetProviderSettingsResult =
  | { status: 'ok'; provider: ProviderSettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export const UpdateProviderSettingsRequestSchema = z
  .object({
    provider_id: ProviderIdSchema,
    patch: ProviderSettingsRawSchema.omit({ api_key: true }),
  })
  .strict();
export type UpdateProviderSettingsRequest = z.infer<typeof UpdateProviderSettingsRequestSchema>;

export type UpdateProviderSettingsResult =
  | { status: 'updated'; provider: ProviderSettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export const SetProviderApiKeyRequestSchema = z
  .object({
    provider_id: ProviderIdSchema,
    api_key: z.string().min(1),
  })
  .strict();
export type SetProviderApiKeyRequest = z.infer<typeof SetProviderApiKeyRequestSchema>;

export type SetProviderApiKeyResult =
  | { status: 'updated'; provider: ProviderSettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export const ClearProviderApiKeyRequestSchema = z
  .object({
    provider_id: ProviderIdSchema,
  })
  .strict();
export type ClearProviderApiKeyRequest = z.infer<typeof ClearProviderApiKeyRequestSchema>;

export type ClearProviderApiKeyResult =
  | { status: 'updated'; provider: ProviderSettingsResolved }
  | { status: 'failed'; failure: SettingsError };

export type ListProviderSettingsResult =
  | { status: 'ok'; providers: ProviderPublicStatus[] }
  | { status: 'failed'; failure: SettingsError };

export type ListAvailableModelsResult =
  | { status: 'ok'; models: AvailableModelOption[] }
  | { status: 'failed'; failure: SettingsError };

export const ResolveProviderRuntimeConfigRequestSchema = z
  .object({
    provider_id: ProviderIdSchema,
    model_id: z.string().min(1),
  })
  .strict();
export type ResolveProviderRuntimeConfigRequest = z.infer<typeof ResolveProviderRuntimeConfigRequestSchema>;

export type ResolveProviderRuntimeConfigResult =
  | { status: 'ok'; config: ProviderRuntimeConfig }
  | { status: 'failed'; failure: SettingsError };

