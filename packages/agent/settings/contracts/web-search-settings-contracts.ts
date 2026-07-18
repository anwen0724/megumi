/*
 * Defines Settings-owned web search configuration and runtime resolution contracts.
 * Secrets may enter Settings through raw updates but are never part of public host DTOs.
 */
import { z } from 'zod';
import type { SettingsError } from './settings-contracts';

export const WebSearchProviderSchema = z.enum(['brave', 'tavily', 'exa', 'custom']);
export type WebSearchProvider = z.infer<typeof WebSearchProviderSchema>;

export const WebSearchSettingsRawSchema = z.object({
  provider: WebSearchProviderSchema.optional(),
  api_key: z.string().min(1).nullable().optional(),
  api_key_env: z.string().min(1).nullable().optional(),
  base_url: z.string().url().nullable().optional(),
}).strict();
export type WebSearchSettingsRaw = z.infer<typeof WebSearchSettingsRawSchema>;

export const WebSearchSettingsResolvedSchema = z.object({
  provider: WebSearchProviderSchema.optional(),
  api_key: z.string().min(1).optional(),
  api_key_env: z.string().min(1).optional(),
  base_url: z.string().url().optional(),
}).strict();
export type WebSearchSettingsResolved = z.infer<typeof WebSearchSettingsResolvedSchema>;

export type WebSearchCredentialSource = 'settings' | 'environment' | 'missing';

export type WebSearchPublicSettings = {
  provider?: WebSearchProvider;
  base_url?: string;
  has_api_key: boolean;
  credential_source: WebSearchCredentialSource;
  api_key_env?: string;
};

export type GetWebSearchSettingsResult =
  | { status: 'ok'; settings: WebSearchPublicSettings }
  | { status: 'failed'; failure: SettingsError };

export type ResolveWebSearchRuntimeConfigResult =
  | {
      status: 'configured';
      config: {
        provider: WebSearchProvider;
        api_key: string;
        base_url?: string;
      };
    }
  | { status: 'unconfigured' }
  | { status: 'failed'; failure: SettingsError };

export const DEFAULT_WEB_SEARCH_API_KEY_ENV: Readonly<Record<Exclude<WebSearchProvider, 'custom'>, string>> = {
  brave: 'BRAVE_SEARCH_API_KEY',
  tavily: 'TAVILY_API_KEY',
  exa: 'EXA_API_KEY',
};
