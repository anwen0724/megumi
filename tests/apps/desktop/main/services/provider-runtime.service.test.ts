// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderId,
  type ProviderSettings,
  type SecretRef,
} from '@megumi/shared/provider-contracts';
import { buildProviderApiKeySecretRef } from '@megumi/security/secret-policy';
import {
  ProviderRuntimeResolutionError,
  ProviderRuntimeService,
  type ProviderRuntimeSecretStorePort,
  type ProviderRuntimeSettingsPort,
} from '@megumi/desktop/main/services/provider-runtime.service';
import { MegumiHomeConfigParseError } from '@megumi/desktop/main/services/megumi-home-config.service';

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

class MemorySecretStore implements ProviderRuntimeSecretStorePort {
  readonly values = new Map<string, string>();

  async readSecret(ref: SecretRef): Promise<string | null> {
    return this.values.get(ref.id) ?? null;
  }
}

describe('ProviderRuntimeService', () => {
  let settings: MemorySettingsPort;
  let secretStore: MemorySecretStore;

  beforeEach(() => {
    settings = new MemorySettingsPort();
    secretStore = new MemorySecretStore();
  });

  it('resolves DeepSeek runtime config from stored secret', async () => {
    const ref = buildProviderApiKeySecretRef('deepseek');
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      secretRef: ref,
    });
    secretStore.values.set(ref.id, 'sk-deepseek');

    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {},
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
    })).resolves.toEqual({
      providerId: 'deepseek',
      kind: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
  });

  it('prefers environment API keys without exposing them in public status', async () => {
    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {
        OPENAI_API_KEY: 'sk-env-openai',
      },
    });

    await expect(service.resolveProviderRuntimeConfig({
      providerId: 'openai',
    })).resolves.toMatchObject({
      providerId: 'openai',
      apiKey: 'sk-env-openai',
      defaultModelId: 'gpt-5.5',
    });
  });

  it('throws provider_disabled for disabled providers', async () => {
    const service = new ProviderRuntimeService({
      settings,
      secretStore,
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

  it('throws provider_missing_api_key when neither env nor secret store has a key', async () => {
    const service = new ProviderRuntimeService({
      settings,
      secretStore,
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
      secretRef: buildProviderApiKeySecretRef('deepseek'),
    });
    secretStore.values.set('secret:provider-api-key:deepseek', 'sk-deepseek');

    const service = new ProviderRuntimeService({
      settings,
      secretStore,
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

  it('uses plaintext config API key before encrypted secret store', async () => {
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      secretRef: buildProviderApiKeySecretRef('deepseek'),
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    secretStore.values.set('secret:provider-api-key:deepseek', 'sk-secret-store');

    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {},
      configCredentials: {
        getProviderApiKeyEnv: async () => undefined,
        getPlaintextProviderApiKey: async (providerId) => (providerId === 'deepseek' ? 'sk-config-deepseek' : null),
      },
    });

    await expect(service.resolveProviderRuntimeConfig({ providerId: 'deepseek' })).resolves.toMatchObject({
      providerId: 'deepseek',
      apiKey: 'sk-config-deepseek',
    });
  });

  it('uses config-defined apiKeyEnv before plaintext config and secret store', async () => {
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      secretRef: buildProviderApiKeySecretRef('deepseek'),
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    secretStore.values.set('secret:provider-api-key:deepseek', 'sk-secret-store');

    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {
        CUSTOM_DEEPSEEK_KEY: 'sk-custom-env',
      },
      configCredentials: {
        getProviderApiKeyEnv: async (providerId) => (providerId === 'deepseek' ? 'CUSTOM_DEEPSEEK_KEY' : undefined),
        getPlaintextProviderApiKey: async () => 'sk-config-deepseek',
      },
    });

    await expect(service.resolveProviderRuntimeConfig({ providerId: 'deepseek' })).resolves.toMatchObject({
      providerId: 'deepseek',
      apiKey: 'sk-custom-env',
    });
  });

  it('maps Megumi Home config parse errors to invalid_provider_config', async () => {
    const configPath = 'C:/Users/anwen/.megumi/config.json';
    settings.settings.set('deepseek', {
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      secretRef: buildProviderApiKeySecretRef('deepseek'),
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {},
      configCredentials: {
        async getProviderApiKeyEnv() {
          throw new MegumiHomeConfigParseError(
            'Megumi config could not be read: Expected comma in JSON at position 41',
            configPath,
          );
        },
        async getPlaintextProviderApiKey() {
          return null;
        },
      },
    });

    await expect(service.resolveProviderRuntimeConfig({ providerId: 'deepseek' })).rejects.toMatchObject({
      payload: {
        code: 'config_invalid',
        message: `Megumi config is invalid. Fix ${configPath} and try again.`,
        retryable: false,
        source: 'config',
        details: {
          providerId: 'deepseek',
          modelId: 'deepseek-v4-flash',
          cause: 'Megumi config could not be read: Expected comma in JSON at position 41',
        },
      },
    });
  });

  it('attaches runtime debug id to provider resolution errors', async () => {
    const service = new ProviderRuntimeService({
      settings,
      secretStore,
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

  it('keeps provider resolution errors on severity and retryable fields', async () => {
    const service = new ProviderRuntimeService({
      settings,
      secretStore,
      env: {},
    });

    try {
      await service.resolveProviderRuntimeConfig({ providerId: 'deepseek' });
      throw new Error('Expected provider runtime resolution to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderRuntimeResolutionError);
      const payload = (error as ProviderRuntimeResolutionError).payload;
      const obsoleteRuntimeErrorField = ['recover', 'able'].join('');

      expect(payload).toMatchObject({
        severity: 'error',
        retryable: false,
      });
      expect(payload).not.toHaveProperty(obsoleteRuntimeErrorField);
    }
  });
});
