/* Defines Web Search settings while keeping credentials behind explicit methods. */
import { z } from 'zod';
import type {
  ReadApiKeyResult,
  SettingsFailureResult,
} from './settings-schema';

export const WebSearchProviderSchema = z.enum(['brave', 'tavily', 'exa', 'custom']);
export type WebSearchProvider = z.infer<typeof WebSearchProviderSchema>;

export const WebSearchSettingsRawSchema = z.object({
  provider: WebSearchProviderSchema.optional(),
  api_key_env: z.string().min(1).nullable().optional(),
  base_url: z.string().url().nullable().optional(),
}).strict();
export type WebSearchSettingsRaw = z.infer<typeof WebSearchSettingsRawSchema>;

// The key remains in settings.json but this schema is not exported publicly.
export const WebSearchSettingsFileRawSchema = WebSearchSettingsRawSchema.extend({
  api_key: z.string().min(1).nullable().optional(),
}).strict();
export type WebSearchSettingsFileRaw = z.infer<typeof WebSearchSettingsFileRawSchema>;

export const WebSearchSettingsResolvedSchema = z.object({
  provider: WebSearchProviderSchema.optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
}).strict();
export type WebSearchSettingsResolved = z.infer<typeof WebSearchSettingsResolvedSchema>;

export type WebSearchCredentialSource = 'settings' | 'environment' | 'missing';
export type ResolvedWebSearchSettings = WebSearchSettingsResolved & {
  has_api_key: boolean;
  credential_source: WebSearchCredentialSource;
};
export type ResolveWebSearchSettingsResult =
  | { status: 'ok'; settings: ResolvedWebSearchSettings }
  | SettingsFailureResult;

export const ReadWebSearchApiKeyRequestSchema = z.object({}).strict();
export type ReadWebSearchApiKeyRequest = z.infer<typeof ReadWebSearchApiKeyRequestSchema>;
export const WriteWebSearchApiKeyRequestSchema = z.object({
  api_key: z.string().min(1),
}).strict();
export type WriteWebSearchApiKeyRequest = z.infer<typeof WriteWebSearchApiKeyRequestSchema>;
export const DeleteWebSearchApiKeyRequestSchema = z.object({}).strict();
export type DeleteWebSearchApiKeyRequest = z.infer<typeof DeleteWebSearchApiKeyRequestSchema>;

export const DEFAULT_WEB_SEARCH_API_KEY_ENV: Readonly<Record<Exclude<WebSearchProvider, 'custom'>, string>> = {
  brave: 'BRAVE_SEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
};

type EnvMap = NodeJS.ProcessEnv | Record<string, string | undefined>;

export function resolveWebSearchSettings(
  resolved: WebSearchSettingsResolved,
  file: WebSearchSettingsFileRaw,
  env: EnvMap,
): ResolvedWebSearchSettings {
  const credential = readWebSearchApiKey(file, env);
  const envName = resolved.api_key_env ?? (resolved.provider && resolved.provider !== 'custom'
    ? DEFAULT_WEB_SEARCH_API_KEY_ENV[resolved.provider]
    : undefined);
  return {
    ...resolved,
    ...(envName ? { api_key_env: envName } : {}),
    has_api_key: credential.status === 'found',
    credential_source: credential.status === 'found' ? credential.source : 'missing',
  };
}

export function readWebSearchApiKey(
  file: WebSearchSettingsFileRaw,
  env: EnvMap,
): ReadApiKeyResult {
  const direct = file.api_key?.trim();
  if (direct) return { status: 'found', api_key: direct, source: 'settings' };
  const envName = file.api_key_env ?? (file.provider && file.provider !== 'custom'
    ? DEFAULT_WEB_SEARCH_API_KEY_ENV[file.provider]
    : undefined);
  const fromEnv = envName ? env[envName]?.trim() : undefined;
  return fromEnv
    ? { status: 'found', api_key: fromEnv, source: 'environment', env_name: envName }
    : { status: 'missing' };
}
