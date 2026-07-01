// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductSettingsService, ProviderSettingsService } from '@megumi/coding-agent/settings';
import {
  type AppSettingsRaw,
  type AppSettingsResolved,
  mergeRawAppSettings,
  resolveAppSettings,
} from '@megumi/coding-agent/settings';

class MemoryAppSettings {
  raw: AppSettingsRaw = {};

  getResolvedSettings(): AppSettingsResolved {
    return resolveAppSettings(this.raw);
  }

  updateSettings(patch: AppSettingsRaw): AppSettingsResolved {
    this.raw = mergeRawAppSettings(this.raw, patch);
    return this.getResolvedSettings();
  }
}

class ProviderMemorySettingsStorage {
  raw: AppSettingsRaw = {};

  readRawSettings(): AppSettingsRaw {
    return this.raw;
  }

  writeRawSettings(next: AppSettingsRaw): void {
    this.raw = next;
  }
}

describe('ProviderSettingsService', () => {
  let settings: MemoryAppSettings;

  beforeEach(() => {
    settings = new MemoryAppSettings();
  });

  it('returns renderer-safe provider statuses from resolved settings defaults', async () => {
    const service = new ProviderSettingsService({
      settings,
      env: {},
    });

    const statuses = await service.listProviderStatuses();

    expect(statuses).toEqual([
      {
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        enabled: true,
        baseUrl: 'https://api.deepseek.com',
        defaultModelId: 'deepseek-v4-flash',
        hasApiKey: false,
        credentialSource: 'missing',
        envOverrideActive: false,
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        apiKeyEnvCustomized: false,
      },
      {
        providerId: 'openai',
        displayName: 'OpenAI',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        defaultModelId: 'gpt-5.5',
        hasApiKey: false,
        credentialSource: 'missing',
        envOverrideActive: false,
        apiKeyEnv: 'OPENAI_API_KEY',
        apiKeyEnvCustomized: false,
      },
      {
        providerId: 'anthropic',
        displayName: 'Anthropic',
        enabled: false,
        defaultModelId: 'claude-sonnet-4-6',
        hasApiKey: false,
        credentialSource: 'missing',
        envOverrideActive: false,
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        apiKeyEnvCustomized: false,
      },
      {
        providerId: 'custom',
        displayName: 'Third-party compatible',
        enabled: false,
        defaultModelId: 'custom-model',
        hasApiKey: false,
        credentialSource: 'missing',
        envOverrideActive: false,
        apiKeyEnvCustomized: false,
      },
    ]);
  });

  it('writes API keys to sparse settings and never returns plaintext in public status', async () => {
    const service = new ProviderSettingsService({
      settings,
      env: {},
    });

    const providerSettings = await service.setProviderApiKey('deepseek', 'sk-deepseek');

    expect(settings.raw).toEqual({
      providers: {
        deepseek: {
          apiKey: 'sk-deepseek',
        },
      },
    });
    expect(providerSettings.apiKey).toBe('sk-deepseek');
    const deepseek = (await service.listProviderStatuses()).find((status) => status.providerId === 'deepseek');
    expect(deepseek).toMatchObject({
      hasApiKey: true,
      credentialSource: 'settings',
      envOverrideActive: false,
    });
    expect(JSON.stringify(deepseek)).not.toContain('sk-deepseek');
  });

  it('deletes API keys from sparse settings', async () => {
    const service = new ProviderSettingsService({
      settings,
      env: {},
    });

    await service.setProviderApiKey('openai', 'sk-openai');
    await service.deleteProviderApiKey('openai');

    expect(settings.raw).toEqual({
      providers: {
        openai: {},
      },
    });
    expect((await service.getProviderSettings('openai')).apiKey).toBeUndefined();
  });

  it('reports configured environment API key names without exposing values', async () => {
    settings.updateSettings({
      providers: {
        deepseek: {
          apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
        },
      },
    });
    const service = new ProviderSettingsService({
      settings,
      env: {
        CUSTOM_DEEPSEEK_KEY: 'sk-custom-env',
      },
    });

    const deepseek = (await service.listProviderStatuses()).find((status) => status.providerId === 'deepseek');

    expect(deepseek).toMatchObject({
      providerId: 'deepseek',
      hasApiKey: true,
      credentialSource: 'environment',
      apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
      apiKeyEnvCustomized: true,
      envOverrideActive: true,
    });
    expect(JSON.stringify(deepseek)).not.toContain('sk-custom-env');
  });

  it('updates non-secret provider settings in settings.json shape', async () => {
    const service = new ProviderSettingsService({
      settings,
      env: {},
    });

    const updated = await service.updateProviderSettings('deepseek', {
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });

    expect(updated).toMatchObject({
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
    expect(settings.raw).toEqual({
      providers: {
        deepseek: {
          enabled: false,
          baseUrl: 'https://proxy.local/deepseek',
          defaultModel: 'deepseek-v4-pro',
        },
      },
    });
  });

  it('updates and clears configured API key environment variable names', async () => {
    const service = new ProviderSettingsService({
      settings,
      env: {
        CUSTOM_OPENAI_KEY: 'sk-custom-openai',
      },
    });

    const updated = await service.updateProviderSettings('openai', {
      apiKeyEnv: 'CUSTOM_OPENAI_KEY',
    });

    expect(updated.apiKeyEnv).toBe('CUSTOM_OPENAI_KEY');
    expect(settings.raw).toEqual({
      providers: {
        openai: {
          apiKeyEnv: 'CUSTOM_OPENAI_KEY',
        },
      },
    });
    expect((await service.listProviderStatuses()).find((status) => status.providerId === 'openai')).toMatchObject({
      hasApiKey: true,
      credentialSource: 'environment',
      apiKeyEnv: 'CUSTOM_OPENAI_KEY',
      apiKeyEnvCustomized: true,
    });

    const cleared = await service.updateProviderSettings('openai', {
      apiKeyEnv: null,
    });

    expect(cleared.apiKeyEnv).toBe('OPENAI_API_KEY');
    expect(settings.raw).toEqual({
      providers: {
        openai: {},
      },
    });
  });

  it('can be backed by the product settings service instead of a shell app settings provider', async () => {
    const storage = new ProviderMemorySettingsStorage();
    const productSettings = new ProductSettingsService({ storage });
    const service = new ProviderSettingsService({
      settings: productSettings,
      env: {},
    });

    await service.updateProviderSettings('deepseek', {
      enabled: false,
      defaultModelId: 'deepseek-product-settings',
    });

    expect(storage.raw).toEqual({
      providers: {
        deepseek: {
          enabled: false,
          defaultModel: 'deepseek-product-settings',
        },
      },
    });
    await expect(service.getProviderSettings('deepseek')).resolves.toMatchObject({
      enabled: false,
      defaultModelId: 'deepseek-product-settings',
    });
  });
});

