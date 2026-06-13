// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { ProviderSettingsService } from '@megumi/desktop/main/services/provider/provider-settings.service';
import {
  type AppSettingsRaw,
  type AppSettingsResolved,
  mergeRawAppSettings,
  resolveAppSettings,
} from '@megumi/shared/settings';

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
      },
      {
        providerId: 'anthropic',
        displayName: 'Anthropic',
        enabled: false,
        defaultModelId: 'claude-sonnet-4-6',
        hasApiKey: false,
        credentialSource: 'missing',
        envOverrideActive: false,
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
});
