/* Defines explicit model configuration without copying the AI model catalog. */
import { z } from 'zod';
import { builtinProviders } from '@megumi/ai/providers/all';

export const EnvironmentVariableSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
export const HttpUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith('https://') || value.startsWith('http://'),
    'Expected an HTTP or HTTPS URL.',
  );
export const ModelReferenceSchema = z
  .object({
    providerId: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
  })
  .strict();

const CapabilitySchema = z.union([z.boolean(), z.literal('unknown')]);
const CapabilitiesSchema = z.object({
  streaming: CapabilitySchema.optional(),
  toolCalls: CapabilitySchema.optional(),
  thinking: CapabilitySchema.optional(),
  imageInput: CapabilitySchema.optional(),
});
const ModelSchema = z.object({
  name: z.string().trim().min(1).optional(),
  contextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  capabilities: CapabilitiesSchema.optional(),
});
const ProviderSchema = z.object({
  name: z.string().trim().min(1).optional(),
  api: z
    .enum([
      'openai-completions',
      'openai-responses',
      'openai-codex-responses',
      'anthropic-messages',
    ])
    .optional(),
  baseUrl: HttpUrlSchema.optional(),
  apiKeyEnv: EnvironmentVariableSchema.optional(),
  models: z.record(z.string().min(1), ModelSchema).default({}),
});

/** Validates explicit provider/model records after global and project values are merged. */
export const ProvidersSettingsSchema = z
  .record(z.string().min(1), ProviderSchema)
  .superRefine((providers, context) => {
    for (const [providerId, provider] of Object.entries(providers)) {
      const builtin = builtinProviders().find((item) => item.id === providerId);
      if (!builtin) {
        if (!provider.api)
          context.addIssue({
            code: 'custom',
            path: [providerId, 'api'],
            message: 'Custom providers require an API protocol.',
          });
        if (!provider.baseUrl)
          context.addIssue({
            code: 'custom',
            path: [providerId, 'baseUrl'],
            message: 'Custom providers require an API address.',
          });
      }
      for (const [modelId, model] of Object.entries(provider.models)) {
        const original = builtin?.getModels().find((item) => item.id === modelId);
        const capacity = model.contextWindowTokens ?? original?.contextWindow;
        const output = model.maxOutputTokens ?? original?.maxTokens;
        if (capacity === undefined)
          context.addIssue({
            code: 'custom',
            path: [providerId, 'models', modelId, 'contextWindowTokens'],
            message: 'Custom models require a context window.',
          });
        if (output === undefined)
          context.addIssue({
            code: 'custom',
            path: [providerId, 'models', modelId, 'maxOutputTokens'],
            message: 'Custom models require maximum output tokens.',
          });
        if (capacity !== undefined && output !== undefined && output > capacity)
          context.addIssue({
            code: 'custom',
            path: [providerId, 'models', modelId, 'maxOutputTokens'],
            message: 'Maximum output exceeds the context window.',
          });
      }
    }
  })
  .default({});
