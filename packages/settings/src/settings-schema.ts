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

export const VoiceRecognitionLanguageSchema = z.enum(['auto', 'zh', 'en']);
export const VoiceSettingsRawSchema = z.object({
  input_device_id: z.string().min(1).optional(),
  output_device_id: z.string().min(1).optional(),
  recognition_language: VoiceRecognitionLanguageSchema.optional(),
}).strict();
export const VoiceSettingsResolvedSchema = z.object({
  input_device_id: z.string().min(1),
  output_device_id: z.string().min(1),
  recognition_language: VoiceRecognitionLanguageSchema,
}).strict();

const settingsShape = {
  language: SettingsLanguageSchema.optional(),
  theme: SettingsThemeNameSchema.optional(),
  setup: SetupSettingsRawSchema.optional(),
  memory: MemorySettingsRawSchema.optional(),
  voice: VoiceSettingsRawSchema.optional(),
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
  voice: VoiceSettingsResolvedSchema,
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
  voice: {
    input_device_id: 'default',
    output_device_id: 'default',
    recognition_language: 'auto',
  },
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

export {
  createSettingsJsonSchema,
  type SettingsJsonSchemaObject,
} from './settings-json-schema';
