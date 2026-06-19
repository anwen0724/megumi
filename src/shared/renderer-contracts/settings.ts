// Renderer-facing application settings DTOs.
import type { ProviderPublicStatus } from './provider';

export interface AppSettings {
  theme?: string;
  providers?: Record<string, Partial<ProviderPublicStatus> & { defaultModel?: string; apiKeyEnv?: string }>;
  memory?: Record<string, unknown>;
  permission?: Record<string, unknown>;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'midnight-blue',
  providers: {},
  memory: {},
  permission: {},
};
