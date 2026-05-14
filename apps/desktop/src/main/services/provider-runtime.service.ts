import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type {
  ProviderId,
  ProviderSettings,
  SecretRef,
} from '@megumi/shared/provider-contracts';
import type { ProviderRuntimeConfig } from '@megumi/ai/types';
import { buildProviderApiKeySecretRef } from '@megumi/security/secret-policy';
import { MegumiHomeConfigParseError } from './megumi-home-config.service';

export interface ProviderRuntimeSettingsPort {
  getProviderSettings(providerId: ProviderId): Promise<ProviderSettings>;
}

export interface ProviderRuntimeSecretStorePort {
  readSecret(ref: SecretRef): Promise<string | null>;
}

export interface ProviderRuntimeConfigCredentialPort {
  getProviderApiKeyEnv(providerId: ProviderId): Promise<string | undefined>;
  getPlaintextProviderApiKey(providerId: ProviderId): Promise<string | null>;
}

export interface ResolveProviderRuntimeConfigInput {
  providerId: ProviderId;
  modelId?: string;
}

export interface ProviderRuntimeServiceOptions {
  settings: ProviderRuntimeSettingsPort;
  secretStore: ProviderRuntimeSecretStorePort;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  configCredentials?: ProviderRuntimeConfigCredentialPort;
}

const PROVIDER_API_KEY_ENV: Record<ProviderId, string> = {
  deepseek: 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

export class ProviderRuntimeResolutionError extends Error {
  constructor(readonly payload: RuntimeError) {
    super(payload.message);
    this.name = 'ProviderRuntimeResolutionError';
  }
}

export class ProviderRuntimeService {
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;

  constructor(private readonly options: ProviderRuntimeServiceOptions) {
    this.env = options.env ?? process.env;
  }

  async resolveProviderRuntimeConfig(
    input: ResolveProviderRuntimeConfigInput,
  ): Promise<ProviderRuntimeConfig> {
    let settings: ProviderSettings;

    try {
      settings = await this.options.settings.getProviderSettings(input.providerId);
    } catch (error) {
      throw this.error({
        code: 'provider_disabled',
        message: 'Provider settings were not found.',
        severity: 'error',
        retryable: false,
        source: 'provider',
        details: {
          providerId: input.providerId,
          ...(error instanceof Error ? { cause: error.message } : {}),
        },
      });
    }

    if (!settings.enabled) {
      throw this.error({
        code: 'provider_disabled',
        message: 'Provider is disabled.',
        severity: 'error',
        retryable: false,
        source: 'provider',
        details: {
          providerId: settings.providerId,
          modelId: input.modelId ?? String(settings.defaultModelId),
        },
      });
    }

    if (settings.kind === 'openai-compatible' && !settings.baseUrl) {
      throw this.error({
        code: 'config_invalid',
        message: 'Provider base URL is required.',
        severity: 'error',
        retryable: false,
        source: 'config',
        details: {
          providerId: settings.providerId,
          modelId: input.modelId ?? String(settings.defaultModelId),
        },
      });
    }

    const apiKey = await this.resolveApiKey(settings);

    if (!apiKey) {
      throw this.error({
        code: 'provider_missing_api_key',
        message: 'Provider API key is missing.',
        severity: 'error',
        retryable: false,
        source: 'provider',
        details: {
          providerId: settings.providerId,
          modelId: input.modelId ?? String(settings.defaultModelId),
        },
      });
    }

    return {
      providerId: settings.providerId,
      kind: settings.kind,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      apiKey,
      defaultModelId: input.modelId ?? settings.defaultModelId,
    };
  }

  private async resolveApiKey(settings: ProviderSettings): Promise<string | null> {
    const envKey = await this.resolveConfiguredEnvKey(settings);
    const envValue = this.env[envKey]?.trim();

    if (envValue) {
      return envValue;
    }

    const plaintextConfigApiKey = await this.resolvePlaintextConfigApiKey(settings);

    if (plaintextConfigApiKey?.trim()) {
      return plaintextConfigApiKey.trim();
    }

    const secretRef = settings.secretRef ?? buildProviderApiKeySecretRef(settings.providerId);
    return this.options.secretStore.readSecret(secretRef);
  }

  private async resolveConfiguredEnvKey(settings: ProviderSettings): Promise<string> {
    try {
      return (
        await this.options.configCredentials?.getProviderApiKeyEnv(settings.providerId)
      ) ?? PROVIDER_API_KEY_ENV[settings.providerId];
    } catch (error) {
      this.throwConfigError(error, settings);
    }
  }

  private async resolvePlaintextConfigApiKey(settings: ProviderSettings): Promise<string | null | undefined> {
    try {
      return await this.options.configCredentials?.getPlaintextProviderApiKey(settings.providerId);
    } catch (error) {
      this.throwConfigError(error, settings);
    }
  }

  private throwConfigError(error: unknown, settings: ProviderSettings): never {
    if (error instanceof MegumiHomeConfigParseError) {
      throw this.error({
        code: 'config_invalid',
        message: `Megumi config is invalid. Fix ${error.configPath} and try again.`,
        severity: 'error',
        retryable: false,
        source: 'config',
        details: {
          providerId: settings.providerId,
          modelId: String(settings.defaultModelId),
          cause: error.message,
        },
      });
    }

    throw error;
  }

  private error(payload: RuntimeError): ProviderRuntimeResolutionError {
    return new ProviderRuntimeResolutionError(payload);
  }
}
