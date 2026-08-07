/* Defines secret-free public Settings models and the internal settings.json schema. */
import { z } from 'zod';
import type { SettingsFailureResult } from './settings-failure-factory';

import {
  ProviderApiSchema,
  ProviderSettingsFileRawSchema,
  ProviderSettingsRawSchema,
  ProviderSettingsResolvedSchema,
} from './provider-settings';
import {
  ContextSettingsRawSchema,
  ContextSettingsResolvedSchema,
  ModelSelectionSettingsSchema,
} from './model-settings';
import {
  PermissionRulesRawSchema,
  PermissionSettingsSchema,
} from './permission-settings';
import {
  WebSearchSettingsFileRawSchema,
  WebSearchSettingsRawSchema,
  WebSearchSettingsResolvedSchema,
} from './web-search-settings';

export const SettingsThemeNameSchema = z.enum([
  'megumi-warm',
  'neutral-light',
  'graphite-dark',
  'sage-mist',
  'midnight-blue',
]);
export type SettingsThemeName = z.infer<typeof SettingsThemeNameSchema>;

export const SettingsLanguageSchema = z.enum(['zh-CN', 'en-US']);
export type SettingsLanguage = z.infer<typeof SettingsLanguageSchema>;

export const SetupSettingsRawSchema = z.object({
  completed: z.boolean().optional(),
  completed_at: z.string().datetime().optional(),
}).strict();
export type SetupSettingsRaw = z.infer<typeof SetupSettingsRawSchema>;

export const SetupSettingsResolvedSchema = z.object({
  completed: z.boolean(),
  completed_at: z.string().datetime().optional(),
}).strict();
export type SetupSettingsResolved = z.infer<typeof SetupSettingsResolvedSchema>;

// Kept only because the current Product Settings Host still exposes this
// compatibility field. Settings does not restore a Memory capability.
export const MemorySettingsRawSchema = z.object({
  enabled: z.boolean().optional(),
}).strict();
export type MemorySettingsRaw = z.infer<typeof MemorySettingsRawSchema>;
export const MemorySettingsResolvedSchema = z.object({
  enabled: z.boolean(),
}).strict();
export type MemorySettingsResolved = z.infer<typeof MemorySettingsResolvedSchema>;

const settingsShape = {
  language: SettingsLanguageSchema.optional(),
  theme: SettingsThemeNameSchema.optional(),
  setup: SetupSettingsRawSchema.optional(),
  memory: MemorySettingsRawSchema.optional(),
  context: ContextSettingsRawSchema.optional(),
  model_selection: ModelSelectionSettingsSchema.optional(),
  permissions: PermissionRulesRawSchema.optional(),
};

export const SettingsRawSchema = z.object({
  ...settingsShape,
  web: z.object({ search: WebSearchSettingsRawSchema.optional() }).strict().optional(),
  providers: z.record(z.string().min(1), ProviderSettingsRawSchema).optional(),
}).strict();
export type SettingsRaw = z.infer<typeof SettingsRawSchema>;

// Read projection for external files: unknown keys are tolerated at every
// nesting level so user edits or future versions never break reading. The
// patch contract above stays strict.
export const SettingsRawReadSchema = z.object({
  ...settingsShape,
  web: z.object({
    search: WebSearchSettingsRawSchema.passthrough().optional(),
  }).strict().optional(),
  providers: z.record(z.string().min(1), ProviderSettingsRawSchema.passthrough()).optional(),
}).passthrough();

// The internal file model is the only Settings model that can contain
// plaintext credentials. It is deliberately not re-exported from index.ts.
// Unknown keys are tolerated because the file is external input: user edits
// or future versions must not make the whole file unreadable.
export const SettingsFileRawSchema = z.object({
  ...settingsShape,
  web: z.object({ search: WebSearchSettingsFileRawSchema.optional() }).strict().optional(),
  providers: z.record(z.string().min(1), ProviderSettingsFileRawSchema).optional(),
}).passthrough();
export type SettingsFileRaw = z.infer<typeof SettingsFileRawSchema>;

export const SettingsResolvedSchema = z.object({
  language: SettingsLanguageSchema,
  theme: SettingsThemeNameSchema,
  setup: SetupSettingsResolvedSchema,
  memory: MemorySettingsResolvedSchema,
  context: ContextSettingsResolvedSchema,
  model_selection: ModelSelectionSettingsSchema.optional(),
  web: z.object({ search: WebSearchSettingsResolvedSchema }).strict(),
  providers: z.record(z.string().min(1), ProviderSettingsResolvedSchema),
  permissions: PermissionSettingsSchema,
}).strict();
export type SettingsResolved = z.infer<typeof SettingsResolvedSchema>;

export const DEFAULT_SETTINGS = SettingsResolvedSchema.parse({
  language: 'zh-CN',
  theme: 'midnight-blue',
  setup: { completed: false },
  memory: { enabled: false },
  context: { compaction_threshold_ratio: 0.8 },
  web: { search: {} },
  providers: {},
  permissions: { mode: 'ask', allow: [], ask: [], deny: [] },
} satisfies SettingsResolved);

export const UpdateSettingsRequestSchema = z.object({
  patch: SettingsRawSchema,
}).strict();
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
export type UpdateSettingsResult =
  | { status: 'updated'; settings: SettingsResolved }
  | SettingsFailureResult;

export const CompleteSetupProviderRequestSchema = z.object({
  provider_id: z.string().min(1),
  enabled: z.boolean().optional(),
  api: ProviderApiSchema.optional(),
  display_name: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
  models: z.array(z.string().min(1)).optional(),
  api_key_env: z.string().min(1).nullable().optional(),
}).strict();
export const CompleteSetupRequestSchema = z.object({
  language: SettingsLanguageSchema.optional(),
  theme: SettingsThemeNameSchema.optional(),
  provider: CompleteSetupProviderRequestSchema.optional(),
}).strict();
export type CompleteSetupRequest = z.infer<typeof CompleteSetupRequestSchema>;
export type CompleteSetupResult =
  | { status: 'completed'; settings: SettingsResolved }
  | SettingsFailureResult;

export {
  createSettingsFailure,
  type DeleteApiKeyResult,
  type JsonObject,
  type ReadApiKeyResult,
  type SettingsFailure,
  type SettingsFailureCode,
  type SettingsFailureResult,
  type SettingsFailureSource,
  type WriteApiKeyResult,
} from './settings-failure-factory';

export type SettingsJsonSchemaObject = Record<string, unknown> & {
  title?: string;
  type?: string | string[];
  properties?: Record<string, SettingsJsonSchemaObject>;
  additionalProperties?: boolean | SettingsJsonSchemaObject;
};

export function createSettingsJsonSchema(): SettingsJsonSchemaObject {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Megumi settings',
    ...zodToJsonSchema(SettingsFileRawSchema),
  };
}

function zodToJsonSchema(schema: z.ZodTypeAny): SettingsJsonSchemaObject {
  if (schema instanceof z.ZodOptional) return zodToJsonSchema(schema.unwrap());
  if (schema instanceof z.ZodNullable) return nullableSchema(zodToJsonSchema(schema.unwrap()));
  if (schema instanceof z.ZodEffects) return zodToJsonSchema(schema.innerType());
  if (schema instanceof z.ZodString) return stringSchema(schema);
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodNumber) return numberSchema(schema);
  if (schema instanceof z.ZodEnum) return { enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { const: schema._def.value };
  if (schema instanceof z.ZodUnion) {
    return { anyOf: schema._def.options.map((option: z.ZodTypeAny) => zodToJsonSchema(option)) };
  }
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return { oneOf: [...schema.options.values()].map((option) => zodToJsonSchema(option)) };
  }
  if (schema instanceof z.ZodArray) {
    return { type: 'array', items: zodToJsonSchema(schema.element) };
  }
  if (schema instanceof z.ZodRecord) {
    return { type: 'object', additionalProperties: zodToJsonSchema(schema.valueSchema) };
  }
  if (schema instanceof z.ZodObject) {
    return {
      type: 'object',
      additionalProperties: schema._def.unknownKeys !== 'strict',
      properties: Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]),
      ),
    };
  }
  throw new Error(`Unsupported settings schema node: ${schema.constructor.name}`);
}

function stringSchema(schema: z.ZodString): SettingsJsonSchemaObject {
  const jsonSchema: SettingsJsonSchemaObject = { type: 'string' };
  for (const check of schema._def.checks) {
    if (check.kind === 'min') jsonSchema.minLength = check.value;
    if (check.kind === 'max') jsonSchema.maxLength = check.value;
    if (check.kind === 'regex') jsonSchema.pattern = check.regex.source;
    if (check.kind === 'url') jsonSchema.format = 'uri';
    if (check.kind === 'datetime') jsonSchema.format = 'date-time';
  }
  return jsonSchema;
}

function numberSchema(schema: z.ZodNumber): SettingsJsonSchemaObject {
  const jsonSchema: SettingsJsonSchemaObject = { type: 'number' };
  for (const check of schema._def.checks) {
    if (check.kind === 'int') jsonSchema.type = 'integer';
    if (check.kind === 'min') {
      if (check.inclusive) jsonSchema.minimum = check.value;
      else jsonSchema.exclusiveMinimum = check.value;
    }
    if (check.kind === 'max') {
      if (check.inclusive) jsonSchema.maximum = check.value;
      else jsonSchema.exclusiveMaximum = check.value;
    }
  }
  return jsonSchema;
}

function nullableSchema(schema: SettingsJsonSchemaObject): SettingsJsonSchemaObject {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  if (Array.isArray(schema.type)) return { ...schema, type: [...new Set([...schema.type, 'null'])] };
  return { anyOf: [schema, { type: 'null' }] };
}
