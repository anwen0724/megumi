// Defines provider configuration contracts shared across Main, Preload, and Renderer.
// Plaintext API keys may exist in Main-owned settings, but renderer-facing status never returns them.
import { z } from 'zod';
import type { IsoDateTime, ProviderSettingsId } from '../primitives/ids';
import type { ModelId } from '../model/contracts';

export const PROVIDER_IDS = ['deepseek', 'openai', 'anthropic'] as const;
export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderKind = 'openai-compatible' | 'anthropic';
export const ProviderKindSchema = z.enum(['openai-compatible', 'anthropic']);

export interface ProviderSettings {
  id: ProviderSettingsId | string;
  providerId: ProviderId;
  kind: ProviderKind;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModelId: ModelId | string;
  apiKey?: string;
  apiKeyEnv?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ProviderCredentialSource = 'settings' | 'environment' | 'missing';

export interface ProviderPublicStatus {
  providerId: ProviderId;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModelId: ModelId | string;
  hasApiKey: boolean;
  credentialSource: ProviderCredentialSource;
  envOverrideActive: boolean;
}

const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = {
  deepseek: {
    id: 'provider-settings:deepseek',
    providerId: 'deepseek',
    kind: 'openai-compatible',
    displayName: 'DeepSeek',
    enabled: true,
    baseUrl: 'https://api.deepseek.com',
    defaultModelId: 'deepseek-v4-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
  },
  openai: {
    id: 'provider-settings:openai',
    providerId: 'openai',
    kind: 'openai-compatible',
    displayName: 'OpenAI',
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-5.5',
    apiKeyEnv: 'OPENAI_API_KEY',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
  },
  anthropic: {
    id: 'provider-settings:anthropic',
    providerId: 'anthropic',
    kind: 'anthropic',
    displayName: 'Anthropic',
    enabled: false,
    defaultModelId: 'claude-sonnet-4-6',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    createdAt: DEFAULT_TIMESTAMP,
    updatedAt: DEFAULT_TIMESTAMP,
  },
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}
