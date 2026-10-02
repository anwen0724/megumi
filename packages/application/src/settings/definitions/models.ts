/* Defines explicit model configuration without copying the AI model catalog. */
import { z } from 'zod';
import { MODELS } from '@megumi/ai/models.generated';

export const EnvironmentVariableSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const HttpUrlSchema = z.string().url().refine(
  (value) => value.startsWith('https://') || value.startsWith('http://'),
  'Expected an HTTP or HTTPS URL.',
);
export const ModelReferenceSchema = z.object({
  providerId: z.string().trim().min(1),
  modelId: z.string().trim().min(1),
}).strict();

const CapabilitySchema = z.union([z.boolean(), z.literal('unknown')]);
const CapabilitiesSchema = z.object({
  streaming: CapabilitySchema.optional(),
  toolCalls: CapabilitySchema.optional(),
  thinking: CapabilitySchema.optional(),
  imageInput: CapabilitySchema.optional(),
});
const ModelFields = {
  displayName: z.string().trim().min(1).optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  capabilities: CapabilitiesSchema.optional(),
  enabled: z.boolean().optional(),
};
const ProviderSchema = z.object({
  enabled: z.boolean().default(true),
  displayName: z.string().trim().min(1).optional(),
  api: z.enum([
    'openai-completions', 'openai-responses',
    'openai-codex-responses', 'anthropic-messages',
  ]).optional(),
  baseUrl: HttpUrlSchema.optional(),
  apiKeyEnv: EnvironmentVariableSchema.optional(),
});
const CustomModelSchema = z.object({
  ...ModelFields,
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  enabled: z.boolean().default(true),
  capabilities: z.object({
    streaming: CapabilitySchema.default('unknown'),
    toolCalls: CapabilitySchema.default('unknown'),
    thinking: CapabilitySchema.default('unknown'),
    imageInput: CapabilitySchema.default('unknown'),
  }).default({}),
});
const ModelOverrideSchema = z.object(ModelFields);

export const ModelsSettingsSchema = z.object({
  defaultModel: ModelReferenceSchema.optional(),
  providers: z.record(z.string().min(1), ProviderSchema).default({}),
  customModels: z.record(z.string().min(1),
    z.record(z.string().min(1), CustomModelSchema)).default({}),
  modelOverrides: z.record(z.string().min(1),
    z.record(z.string().min(1), ModelOverrideSchema)).default({}),
}).superRefine((settings, context) => {
  for (const [providerId, provider] of Object.entries(settings.providers)) {
    if (Object.hasOwn(MODELS, providerId)) continue;
    if (!provider.api) {
      context.addIssue({ code: 'custom', path: ['providers', providerId, 'api'], message: 'Custom providers require an API protocol.' });
    }
    if (!provider.baseUrl) {
      context.addIssue({ code: 'custom', path: ['providers', providerId, 'baseUrl'], message: 'Custom providers require an API address.' });
    }
  }
  for (const collection of ['customModels', 'modelOverrides'] as const) {
    for (const [providerId, models] of Object.entries(settings[collection])) {
      for (const [modelId, model] of Object.entries(models)) {
        if (model.maxOutputTokens !== undefined && model.contextWindowTokens !== undefined
          && model.maxOutputTokens > model.contextWindowTokens) {
          context.addIssue({ code: 'custom', path: [collection, providerId, modelId, 'maxOutputTokens'], message: 'Maximum output exceeds the context window.' });
        }
      }
    }
  }
}).default({});
