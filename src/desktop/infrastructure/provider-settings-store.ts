// Projects desktop settings into renderer-safe provider status and AI credentials.
import type { CredentialResolver, ProviderCredential } from '../../ai';
import type { AppSettingsRaw, AppSettingsStore, ProviderId, ProviderSettingsResolved } from './app-settings-store';

export type ProviderCredentialSource = 'settings' | 'environment' | 'missing';

export interface ProviderPublicStatus {
  providerId: ProviderId;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  defaultModelId: string;
  hasApiKey: boolean;
  credentialSource: ProviderCredentialSource;
  envOverrideActive: boolean;
  apiKeyEnv?: string;
  apiKeyEnvCustomized?: boolean;
}

export interface ProviderSettingsUpdateInput {
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  defaultModelId?: string;
  apiKeyEnv?: string | null;
}

export interface ProviderSettingsStore extends CredentialResolver {
  listProviderStatuses(): ProviderPublicStatus[];
  getProviderSettings(providerId: ProviderId): ProviderSettingsResolved;
  updateProviderSettings(providerId: ProviderId, input: ProviderSettingsUpdateInput): ProviderPublicStatus;
  setProviderApiKey(providerId: ProviderId, apiKey: string): ProviderPublicStatus;
  deleteProviderApiKey(providerId: ProviderId): ProviderPublicStatus;
}

export interface CreateProviderSettingsStoreOptions {
  settings: AppSettingsStore;
  env?: Record<string, string | undefined> | { get(name: string): string | undefined };
}

const DEFAULT_PROVIDER_ENV: Record<ProviderId, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export function createProviderSettingsStore(options: CreateProviderSettingsStoreOptions): ProviderSettingsStore {
  const env = options.env ?? process.env;
  function provider(providerId: ProviderId): ProviderSettingsResolved {
    return options.settings.getResolvedSettings().providers[providerId];
  }
  function status(providerId: ProviderId): ProviderPublicStatus {
    const settings = provider(providerId);
    const defaultEnv = DEFAULT_PROVIDER_ENV[providerId];
    const envKey = settings.apiKeyEnv ?? defaultEnv;
    const settingsActive = Boolean(settings.apiKey?.trim());
    const envActive = Boolean(envKey && readEnv(env, envKey)?.trim());
    return {
      providerId,
      displayName: settings.displayName,
      enabled: settings.enabled,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      defaultModelId: settings.defaultModel,
      hasApiKey: settingsActive || envActive,
      credentialSource: settingsActive ? 'settings' : envActive ? 'environment' : 'missing',
      envOverrideActive: envActive,
      ...(envKey ? { apiKeyEnv: envKey } : {}),
      apiKeyEnvCustomized: Boolean(envKey && envKey !== defaultEnv),
    };
  }
  function patch(providerId: ProviderId, providerPatch: Record<string, unknown>): ProviderPublicStatus {
    options.settings.updateSettings({
      providers: {
        [providerId]: providerPatch,
      },
    } as AppSettingsRaw);
    return status(providerId);
  }
  return {
    listProviderStatuses: () => (['deepseek', 'openai', 'anthropic'] as const).map(status),
    getProviderSettings: provider,
    updateProviderSettings(providerId, input) {
      return patch(providerId, {
        enabled: input.enabled,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModelId,
        apiKeyEnv: input.apiKeyEnv,
      });
    },
    setProviderApiKey: (providerId, apiKey) => patch(providerId, { apiKey }),
    deleteProviderApiKey: (providerId) => patch(providerId, { apiKey: null }),
    async resolveCredential(providerId) {
      if (!isProviderId(providerId)) return undefined;
      const settings = provider(providerId);
      if (settings.apiKey?.trim()) {
        return { type: 'api_key', value: settings.apiKey.trim() } satisfies ProviderCredential;
      }
      const envKey = settings.apiKeyEnv ?? DEFAULT_PROVIDER_ENV[providerId];
      const envValue = envKey ? readEnv(env, envKey)?.trim() : undefined;
      return envValue ? { type: 'api_key', value: envValue } satisfies ProviderCredential : undefined;
    },
  };
}

function readEnv(env: NonNullable<CreateProviderSettingsStoreOptions['env']>, key: string): string | undefined {
  const maybeReader = env as { get?: unknown };
  return typeof maybeReader.get === 'function'
    ? maybeReader.get(key)
    : (env as Record<string, string | undefined>)[key];
}

function isProviderId(value: string): value is ProviderId {
  return value === 'deepseek' || value === 'openai' || value === 'anthropic';
}
