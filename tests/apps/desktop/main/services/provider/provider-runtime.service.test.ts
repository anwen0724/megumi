// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderId,
  type ProviderSettings,
} from '@megumi/shared/provider';
import {
  ProviderRuntimeResolutionError,
  ProviderRuntimeService,
  type ProviderRuntimeSettingsPort,
} from '@megumi/desktop/main/services/provider/provider-runtime.service';

class MemorySettingsPort implements ProviderRuntimeSettingsPort {
  readonly settings = new Map<ProviderId, ProviderSettings>();

  constructor() {
    for (const providerSettings of Object.values(DEFAULT_PROVIDER_SETTINGS)) {
      this.settings.set(providerSettings.providerId, providerSettings);
    }
  }

  async getProviderSettings(providerId: ProviderId): Promise<ProviderSettings> {
    const settings = this.settings.get(providerId);

    if (!settings) {
      throw new Error(`Missing settings: ${providerId}`);
    }

    return settings;
  }
}

describe('ProviderRuntimeService', () => {
  let settings: MemorySettingsPort;

  beforeEach(() => {
    settings = new MemorySettingsPort();
  });

  it('prefers settings.json API keys over environment API keys', async () => {
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      apiKey: 'sk-settings-deepseek',
    });
    const service = new ProviderRuntimeService({
      settings,
      env: {
        DEEPSEEK_API_KEY: 'sk-env-deepseek',
      },
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
    })).resolves.toEqual({
      providerId: 'deepseek',
      kind: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-settings-deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('uses configured environment API key names when settings apiKey is absent', async () => {
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
    });
    const service = new ProviderRuntimeService({
      settings,
      env: {
        CUSTOM_DEEPSEEK_KEY: 'sk-custom-env',
      },
    });

    await expect(service.resolveProviderRuntimeConfig({ providerId: 'deepseek' })).resolves.toMatchObject({
      providerId: 'deepseek',
      apiKey: 'sk-custom-env',
    });
  });

  it('throws provider_disabled for disabled providers', async () => {
    const service = new ProviderRuntimeService({
      settings,
      env: {},
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'anthropic',
    })).rejects.toMatchObject({
      payload: {
        code: 'provider_disabled',
        retryable: false,
        source: 'provider',
        details: {
          providerId: 'anthropic',
        },
      },
    });
  });

  it('throws provider_missing_api_key when neither settings nor env has a key', async () => {
    const service = new ProviderRuntimeService({
      settings,
      env: {},
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
    })).rejects.toBeInstanceOf(ProviderRuntimeResolutionError);

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
    })).rejects.toMatchObject({
      payload: {
        code: 'provider_missing_api_key',
        retryable: false,
        source: 'provider',
        details: {
          providerId: 'deepseek',
        },
      },
    });
  });

  it('throws invalid_provider_config for OpenAI-compatible providers without base URL', async () => {
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      baseUrl: undefined,
      apiKey: 'sk-deepseek',
    });
    const service = new ProviderRuntimeService({
      settings,
      env: {},
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
    })).rejects.toMatchObject({
      payload: {
        code: 'config_invalid',
        message: 'Provider base URL is required.',
        source: 'config',
      },
    });
  });

  it('attaches runtime debug id to provider resolution errors', async () => {
    const service = new ProviderRuntimeService({
      settings,
      env: {},
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
      runtimeContext: {
        requestId: 'ipc-chat-start-1',
        traceId: 'trace-provider-1',
        debugId: 'debug-provider-1',
        operationName: 'session.message.send',
        source: 'main',
        createdAt: '2026-05-12T00:00:00.000Z',
      },
    })).rejects.toMatchObject({
      payload: {
        code: 'provider_missing_api_key',
        severity: 'error',
        retryable: false,
        source: 'provider',
        debugId: 'debug-provider-1',
      },
    });
  });
});
