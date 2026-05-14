import {
  type ProviderId,
  type ProviderPublicStatus,
  type ProviderSettings,
  type SecretRef,
} from '@megumi/shared/provider-contracts';
import { buildProviderApiKeySecretRef } from '@megumi/security/secret-policy';

export interface ProviderSettingsRepositoryPort {
  initializeDefaults(): void;
  list(): ProviderSettings[];
  get(providerId: ProviderId): ProviderSettings | undefined;
  updateProvider(providerId: ProviderId, update: Partial<ProviderSettings>): ProviderSettings;
}

export interface ProviderSecretStorePort {
  setSecret(ref: SecretRef, value: string): Promise<void>;
  hasSecret(ref: SecretRef): Promise<boolean>;
  deleteSecret(ref: SecretRef): Promise<void>;
}

export interface ProviderConfigCredentialPort {
  getProviderApiKeyEnv(providerId: ProviderId): Promise<string | undefined>;
  getPlaintextProviderApiKey(providerId: ProviderId): Promise<string | null>;
}

export interface ProviderSettingsServiceOptions {
  repository: ProviderSettingsRepositoryPort;
  secretStore: ProviderSecretStorePort;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  configCredentials?: ProviderConfigCredentialPort;
}

export interface ProviderSettingsUpdateInput {
  enabled?: boolean;
  displayName?: string;
  baseUrl?: string;
  defaultModelId?: string;
}

const PROVIDER_API_KEY_ENV: Record<ProviderId, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const LEGACY_DEFAULT_MODEL_MIGRATIONS: Partial<Record<ProviderId, Record<string, string>>> = {
  deepseek: {
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-flash',
  },
  openai: {
    'gpt-4.1': 'gpt-5.5',
    'gpt-5.1': 'gpt-5.5',
  },
  anthropic: {
    'claude-3-5-sonnet-latest': 'claude-sonnet-4-6',
    'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
    'claude-opus-4-1-20250805': 'claude-opus-4-7',
  },
};

export class ProviderSettingsService {
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;

  constructor(private readonly options: ProviderSettingsServiceOptions) {
    this.env = options.env ?? process.env;
  }

  async listProviderStatuses(): Promise<ProviderPublicStatus[]> {
    this.options.repository.initializeDefaults();

    const settingsList = this.options.repository.list().map((settings) => this.normalizeDefaultModel(settings));
    return Promise.all(settingsList.map((settings) => this.toPublicStatus(settings)));
  }

  async getProviderSettings(providerId: ProviderId): Promise<ProviderSettings> {
    this.options.repository.initializeDefaults();

    const settings = this.options.repository.get(providerId);

    if (!settings) {
      throw new Error(`Provider settings not found: ${providerId}`);
    }

    return this.normalizeDefaultModel(settings);
  }

  async updateProviderSettings(
    providerId: ProviderId,
    input: ProviderSettingsUpdateInput,
  ): Promise<ProviderSettings> {
    this.options.repository.initializeDefaults();
    return this.options.repository.updateProvider(providerId, input);
  }

  async setProviderApiKey(providerId: ProviderId, apiKey: string): Promise<ProviderSettings> {
    this.options.repository.initializeDefaults();

    const secretRef = buildProviderApiKeySecretRef(providerId);
    await this.options.secretStore.setSecret(secretRef, apiKey);

    return this.options.repository.updateProvider(providerId, { secretRef });
  }

  async deleteProviderApiKey(providerId: ProviderId): Promise<ProviderSettings> {
    this.options.repository.initializeDefaults();

    const secretRef = buildProviderApiKeySecretRef(providerId);
    await this.options.secretStore.deleteSecret(secretRef);

    return this.options.repository.updateProvider(providerId, { secretRef: undefined });
  }

  private async toPublicStatus(settings: ProviderSettings): Promise<ProviderPublicStatus> {
    const secretRef = settings.secretRef ?? buildProviderApiKeySecretRef(settings.providerId);
    const hasSecret = await this.options.secretStore.hasSecret(secretRef);
    const envOverrideActive = await this.hasEnvironmentApiKey(settings.providerId);
    const hasConfigApiKey = Boolean(await this.options.configCredentials?.getPlaintextProviderApiKey(settings.providerId));

    return {
      providerId: settings.providerId,
      displayName: settings.displayName,
      enabled: settings.enabled,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      defaultModelId: settings.defaultModelId,
      hasSecret,
      credentialSource: envOverrideActive
        ? 'environment'
        : hasConfigApiKey
          ? 'config'
          : hasSecret
            ? 'secret-store'
            : 'missing',
      envOverrideActive,
    };
  }

  private normalizeDefaultModel(settings: ProviderSettings): ProviderSettings {
    const migration = LEGACY_DEFAULT_MODEL_MIGRATIONS[settings.providerId]?.[String(settings.defaultModelId)];

    if (!migration) {
      return settings;
    }

    return this.options.repository.updateProvider(settings.providerId, {
      defaultModelId: migration,
    });
  }

  private async hasEnvironmentApiKey(providerId: ProviderId): Promise<boolean> {
    const envKey = (await this.options.configCredentials?.getProviderApiKeyEnv(providerId)) ?? PROVIDER_API_KEY_ENV[providerId];
    return Boolean(this.env[envKey]?.trim());
  }
}
