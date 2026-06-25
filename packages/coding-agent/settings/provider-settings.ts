// Projects product settings provider configuration into public provider status.
// API keys may be written to settings.json, but this service never returns plaintext keys to callers.
// The env port is required so the product composition can resolve host process overrides.
import {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderPublicStatus,
  type ProviderSettings,
} from '@megumi/shared/provider';
import type { AppSettingsRaw, AppSettingsResolved } from '@megumi/shared/settings';

export interface ProviderSettingsAppSettingsPort {
  getResolvedSettings(): AppSettingsResolved;
  updateSettings(patch: AppSettingsRaw): AppSettingsResolved;
}

export interface ProviderSettingsServiceOptions {
  settings: ProviderSettingsAppSettingsPort;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export interface ProviderSettingsUpdateInput {
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  defaultModelId?: string;
  apiKeyEnv?: string | null;
}

// Product-facing provider settings surface consumed by UI shells. Shells code
// against this port, not the concrete ProviderSettingsService. API keys may be
// written, but the port never returns plaintext keys.
export interface ProviderSettingsPort {
  listProviderStatuses(): Promise<ProviderPublicStatus[]>;
  getProviderSettings(providerId: ProviderId): Promise<ProviderSettings>;
  updateProviderSettings(providerId: ProviderId, input: ProviderSettingsUpdateInput): Promise<ProviderSettings>;
  setProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderSettings>;
  deleteProviderApiKey(providerId: ProviderId): Promise<ProviderSettings>;
}

export class ProviderSettingsService implements ProviderSettingsPort {
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;

  constructor(private readonly options: ProviderSettingsServiceOptions) {
    this.env = options.env;
  }

  async listProviderStatuses(): Promise<ProviderPublicStatus[]> {
    return PROVIDER_IDS.map((providerId) => this.toPublicStatus(this.getProviderSettingsSync(providerId)));
  }

  async getProviderSettings(providerId: ProviderId): Promise<ProviderSettings> {
    return this.getProviderSettingsSync(providerId);
  }

  async updateProviderSettings(
    providerId: ProviderId,
    input: ProviderSettingsUpdateInput,
  ): Promise<ProviderSettings> {
    this.options.settings.updateSettings({
      providers: {
        [providerId]: {
          enabled: input.enabled,
          displayName: input.displayName,
          baseUrl: input.baseUrl,
          defaultModel: input.defaultModelId,
          apiKeyEnv: input.apiKeyEnv,
        },
      },
    });
    return this.getProviderSettingsSync(providerId);
  }

  async setProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderSettings> {
    this.options.settings.updateSettings({
      providers: {
        [providerId]: {
          apiKey,
        },
      },
    });
    return this.getProviderSettingsSync(providerId);
  }

  async deleteProviderApiKey(providerId: ProviderId): Promise<ProviderSettings> {
    this.options.settings.updateSettings({
      providers: {
        [providerId]: {
          apiKey: null,
        },
      },
    });
    return this.getProviderSettingsSync(providerId);
  }

  private getProviderSettingsSync(providerId: ProviderId): ProviderSettings {
    const provider = this.options.settings.getResolvedSettings().providers[providerId];
    const defaults = DEFAULT_PROVIDER_SETTINGS[providerId];
    return {
      id: defaults.id,
      providerId,
      kind: provider.kind,
      displayName: provider.displayName,
      enabled: provider.enabled,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      defaultModelId: provider.defaultModel,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.apiKeyEnv ? { apiKeyEnv: provider.apiKeyEnv } : {}),
      createdAt: defaults.createdAt,
      updatedAt: new Date().toISOString(),
    };
  }

  private toPublicStatus(settings: ProviderSettings): ProviderPublicStatus {
    const defaultEnvKey = DEFAULT_PROVIDER_SETTINGS[settings.providerId].apiKeyEnv;
    const envKey = settings.apiKeyEnv ?? defaultEnvKey;
    const envOverrideActive = Boolean(envKey && this.env[envKey]?.trim());
    const settingsApiKeyActive = Boolean(settings.apiKey?.trim());

    return {
      providerId: settings.providerId,
      displayName: settings.displayName,
      enabled: settings.enabled,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      defaultModelId: settings.defaultModelId,
      hasApiKey: settingsApiKeyActive || envOverrideActive,
      credentialSource: settingsApiKeyActive
        ? 'settings'
        : envOverrideActive
          ? 'environment'
          : 'missing',
      envOverrideActive,
      ...(envKey ? { apiKeyEnv: envKey } : {}),
      apiKeyEnvCustomized: Boolean(envKey && envKey !== defaultEnvKey),
    };
  }
}
