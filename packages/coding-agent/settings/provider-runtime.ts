// Resolves provider runtime configuration from Main-owned settings and the env port only.
// SQLite and other host persistence details are kept outside provider request execution.
// The env port is required ¡ª the desktop composition supplies the host process environment.
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type {
  ProviderId,
  ProviderSettings,
} from '@megumi/shared/provider';
import { DEFAULT_PROVIDER_SETTINGS } from '@megumi/shared/provider';
import type { ProviderRuntimeConfig } from '@megumi/coding-agent/run';

export interface ProviderRuntimeSettingsPort {
  getProviderSettings(providerId: ProviderId): Promise<ProviderSettings>;
}

export interface ResolveProviderRuntimeConfigInput {
  providerId: ProviderId;
  modelId?: string;
  runtimeContext?: RuntimeContext;
}

export interface ProviderRuntimeServiceOptions {
  settings: ProviderRuntimeSettingsPort;
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

export class ProviderRuntimeResolutionError extends Error {
  constructor(readonly payload: RuntimeError) {
    super(payload.message);
    this.name = 'ProviderRuntimeResolutionError';
  }
}

export class ProviderRuntimeService {
  private readonly env: NodeJS.ProcessEnv | Record<string, string | undefined>;

  constructor(private readonly options: ProviderRuntimeServiceOptions) {
    this.env = options.env;
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
      }, input.runtimeContext);
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
      }, input.runtimeContext);
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
      }, input.runtimeContext);
    }

    const apiKey = this.resolveApiKey(settings);

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
      }, input.runtimeContext);
    }

    return {
      providerId: settings.providerId,
      kind: settings.kind,
      ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
      apiKey,
      defaultModelId: input.modelId ?? settings.defaultModelId,
    };
  }

  private resolveApiKey(settings: ProviderSettings): string | null {
    const settingsApiKey = settings.apiKey?.trim();
    if (settingsApiKey) {
      return settingsApiKey;
    }

    const envKey = settings.apiKeyEnv ?? DEFAULT_PROVIDER_SETTINGS[settings.providerId].apiKeyEnv;
    const envValue = envKey ? this.env[envKey]?.trim() : undefined;
    return envValue || null;
  }

  private error(payload: RuntimeError, runtimeContext?: RuntimeContext): ProviderRuntimeResolutionError {
    return new ProviderRuntimeResolutionError({
      ...payload,
      ...(runtimeContext?.debugId && !payload.debugId ? { debugId: runtimeContext.debugId } : {}),
    });
  }
}
