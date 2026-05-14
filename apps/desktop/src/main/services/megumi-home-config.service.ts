import fs from 'fs-extra';
import {
  type MegumiHomeConfig,
  type MegumiProviderConfig,
} from './megumi-home.service';
import {
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  type ProviderId,
  type ProviderSettings,
} from '@megumi/shared/provider-contracts';

export interface MegumiHomeConfigFileSystem {
  readJson(filePath: string): Promise<unknown>;
}

export interface MegumiHomeConfigServiceOptions {
  configPath: string;
  fileSystem?: MegumiHomeConfigFileSystem;
}

export class MegumiHomeConfigParseError extends Error {
  readonly code = 'megumi_home_config_parse_error';

  constructor(message: string, readonly configPath: string) {
    super(message);
    this.name = 'MegumiHomeConfigParseError';
  }
}

export class MegumiHomeConfigService {
  private readonly fileSystem: MegumiHomeConfigFileSystem;

  constructor(private readonly options: MegumiHomeConfigServiceOptions) {
    this.fileSystem = options.fileSystem ?? fs;
  }

  async loadConfig(): Promise<MegumiHomeConfig> {
    let rawConfig: unknown;

    try {
      rawConfig = await this.fileSystem.readJson(this.options.configPath);
    } catch (error) {
      throw this.parseError(
        `Megumi config could not be read: ${error instanceof Error ? error.message : 'Unknown error.'}`,
      );
    }

    return this.parseConfig(rawConfig);
  }

  async listProviderSettings(): Promise<ProviderSettings[]> {
    const config = await this.loadConfig();

    return PROVIDER_IDS.map((providerId) => this.toProviderSettings(providerId, config.providers[providerId]));
  }

  async getProviderSettings(providerId: ProviderId): Promise<ProviderSettings> {
    const config = await this.loadConfig();
    return this.toProviderSettings(providerId, config.providers[providerId]);
  }

  async getProviderApiKeyEnv(providerId: ProviderId): Promise<string | undefined> {
    const config = await this.loadConfig();
    return config.providers[providerId]?.apiKeyEnv?.trim() || undefined;
  }

  async getPlaintextProviderApiKey(providerId: ProviderId): Promise<string | null> {
    const config = await this.loadConfig();
    return config.providers[providerId]?.apiKey?.trim() || null;
  }

  private parseConfig(value: unknown): MegumiHomeConfig {
    if (!isRecord(value)) {
      throw this.parseError('Megumi config must be an object.');
    }

    if (value.version !== 1) {
      throw this.parseError('Megumi config version must be 1.');
    }

    if (!isRecord(value.app)) {
      throw this.parseError('Megumi config app section must be an object.');
    }

    if (typeof value.app.theme !== 'string' || typeof value.app.language !== 'string') {
      throw this.parseError('Megumi config app section requires theme and language strings.');
    }

    if (!isRecord(value.chat) || typeof value.chat.defaultProvider !== 'string') {
      throw this.parseError('Megumi config chat.defaultProvider must be a string.');
    }

    if (!isRecord(value.providers)) {
      throw this.parseError('Megumi config providers section must be an object.');
    }

    for (const providerId of PROVIDER_IDS) {
      this.parseProviderConfig(providerId, value.providers[providerId]);
    }

    return value as unknown as MegumiHomeConfig;
  }

  private parseProviderConfig(providerId: ProviderId, value: unknown): void {
    if (!isRecord(value)) {
      throw this.parseError(`Megumi config providers.${providerId} must be an object.`);
    }

    if (typeof value.enabled !== 'boolean') {
      throw this.parseError(`Megumi config providers.${providerId}.enabled must be a boolean.`);
    }

    if (value.kind !== 'openai-compatible' && value.kind !== 'anthropic') {
      throw this.parseError(`Megumi config providers.${providerId}.kind is invalid.`);
    }

    for (const property of ['displayName', 'defaultModel']) {
      if (typeof value[property] !== 'string' || !value[property].trim()) {
        throw this.parseError(`Megumi config providers.${providerId}.${property} must be a non-empty string.`);
      }
    }

    for (const property of ['baseUrl', 'apiKeyEnv', 'apiKey', 'secretRef']) {
      if (value[property] !== undefined && typeof value[property] !== 'string') {
        throw this.parseError(`Megumi config providers.${providerId}.${property} must be a string when set.`);
      }
    }
  }

  private toProviderSettings(providerId: ProviderId, config: MegumiProviderConfig | undefined): ProviderSettings {
    const defaults = DEFAULT_PROVIDER_SETTINGS[providerId];

    if (!config) {
      return defaults;
    }

    return {
      ...defaults,
      kind: config.kind,
      displayName: config.displayName,
      enabled: config.enabled,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : { baseUrl: undefined }),
      defaultModelId: config.defaultModel,
    };
  }

  private parseError(message: string): MegumiHomeConfigParseError {
    return new MegumiHomeConfigParseError(message, this.options.configPath);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
