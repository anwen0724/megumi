/* Defines renderer-safe Settings Host DTOs, schemas, and pure mappings. */
import { z } from 'zod';
import {
  ConfigurationSchema,
  ConfigurationPatchSchema,
  type SettingsConfiguration,
} from './settings-schema';
import { EnvironmentVariableSchema } from './definitions/providers';

export const CredentialTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('provider'), providerId: z.string().trim().min(1) }).strict(),
  z.object({ kind: z.literal('webSearch') }).strict(),
  z.object({ kind: z.literal('voiceTts') }).strict(),
  z.object({ kind: z.literal('discoverySource'), sourceId: z.enum(['twitter', 'zhihu', 'tavily']) }).strict(),
]);
export type CredentialTarget = z.infer<typeof CredentialTargetSchema>;
export const ReadCredentialRequestSchema = z
  .object({
    target: CredentialTargetSchema,
    apiKeyEnv: EnvironmentVariableSchema.optional(),
    defaultEnvNames: z.array(EnvironmentVariableSchema).readonly().optional(),
  })
  .strict();
export type ReadCredentialRequest = z.infer<typeof ReadCredentialRequestSchema>;
export const UpdateCredentialRequestSchema = z
  .object({
    target: CredentialTargetSchema,
    value: z.string().trim().min(1).nullable(),
  })
  .strict();
export type UpdateCredentialRequest = z.infer<typeof UpdateCredentialRequestSchema>;
export interface CredentialError {
  code: 'CREDENTIAL_INVALID' | 'CREDENTIAL_FILE_INVALID';
  message: string;
}
export type ReadCredentialResult =
  | { status: 'found'; value: string; source: 'stored' | 'environment' }
  | { status: 'missing' }
  | { status: 'rejected'; error: CredentialError };
export type UpdateCredentialResult =
  { status: 'updated' | 'unchanged' } | { status: 'rejected'; error: CredentialError };

export type SettingsScope = 'global' | 'project';
export interface SettingsError {
  code: 'SETTINGS_INVALID' | 'SETTINGS_SCOPE_INVALID' | 'SETTINGS_CONFLICT';
  message: string;
  issues?: readonly { scope?: SettingsScope; path: readonly string[]; message: string }[];
}
export interface SettingsSnapshot {
  config: SettingsConfiguration;
  sources: readonly { path: readonly string[]; source: 'default' | SettingsScope }[];
  revision: string;
  diagnostics: readonly {
    code: 'SETTINGS_UNKNOWN_FIELD';
    scope: SettingsScope;
    path: readonly string[];
    message: string;
  }[];
}
export type ReadSettingsResult =
  { status: 'ok'; settings: SettingsSnapshot } | { status: 'rejected'; error: SettingsError };

export interface SettingsModelReference {
  providerId: string;
  modelId: string;
}

export type SettingsFieldPatch<T> = T extends readonly unknown[]
  ? T | null
  : T extends SettingsModelReference
    ? T | null
    : T extends object
      ? { [K in keyof T]?: SettingsFieldPatch<NonNullable<T[K]>> } | null
      : T | null;

export type SettingsPatch = {
  [K in keyof SettingsConfiguration]?: SettingsFieldPatch<SettingsConfiguration[K]>;
};

export interface UpdateSettingsRequest {
  patch: SettingsPatch;
  expectedRevision: string;
}

export type UpdateSettingsResult =
  | { status: 'updated' | 'unchanged'; settings: SettingsSnapshot }
  | { status: 'rejected'; error: SettingsError };

export const SettingsSnapshotSchema = z.object({
  config: ConfigurationSchema,
  sources: z
    .array(
      z.object({
        path: z.array(z.string()).readonly(),
        source: z.enum(['default', 'global', 'project']),
      }),
    )
    .readonly(),
  revision: z.string(),
  diagnostics: z
    .array(
      z.object({
        code: z.literal('SETTINGS_UNKNOWN_FIELD'),
        scope: z.enum(['global', 'project']),
        path: z.array(z.string()).readonly(),
        message: z.string(),
      }),
    )
    .readonly(),
});
export const SettingsEditRequestSchema = z
  .object({ patch: ConfigurationPatchSchema, expectedRevision: z.string() })
  .strict();
export const SettingsEditResultSchema = z.object({
  status: z.enum(['updated', 'unchanged']),
  settings: SettingsSnapshotSchema,
});
export const CredentialValueSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'),
    value: z.string(),
    source: z.enum(['stored', 'environment']),
  }),
  z.object({ status: z.literal('missing') }),
]);
export type CredentialValue = z.infer<typeof CredentialValueSchema>;
export const CredentialUpdateResultSchema = z.object({ status: z.enum(['updated', 'unchanged']) });

export type AppLanguage = SettingsConfiguration['general']['language'];
export type AppThemeName = SettingsConfiguration['general']['theme'];
