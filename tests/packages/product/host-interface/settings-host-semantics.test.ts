import { describe, expect, it, vi } from 'vitest';
import { createSettingsHost } from '@megumi/product/host-interface/settings-host';

describe('SettingsHost semantics', () => {
  it('projects owner failures instead of throwing Error(message)', async () => {
    const host = createSettingsHost({
      getResolvedSettings: vi.fn(() => ({
        status: 'failed' as const,
        failure: { code: 'settings_invalid', message: 'Settings are invalid.', retryable: false },
      })),
    } as never);

    await expect(host.get()).resolves.toEqual({
      status: 'failed',
      failure: { code: 'settings_invalid', message: 'Settings are invalid.', retryable: false },
    });
  });

  it('does not drop schema-accepted empty provider fields during patch mapping', async () => {
    const updateProviderSettings = vi.fn(() => ({
      status: 'updated' as const,
      provider: providerSettings(),
    }));
    const host = createSettingsHost({
      updateProviderSettings,
    } as never);

    await host.updateProvider({
      providerId: 'provider:1',
      displayName: '',
      baseUrl: '',
      modelIds: [],
    });

    expect(updateProviderSettings).toHaveBeenCalledWith({
      provider_id: 'provider:1',
      patch: {
        display_name: '',
        base_url: '',
        models: {},
      },
    });
  });

  it('maps sparse model capability overrides without inventing defaults', async () => {
    const updateProviderSettings = vi.fn(() => ({
      status: 'updated' as const,
      provider: providerSettings(),
    }));
    const host = createSettingsHost({ updateProviderSettings } as never);

    await host.updateProvider({
      providerId: 'provider:1',
      modelIds: ['model:known', 'model:custom'],
      modelCapabilities: {
        'model:known': { imageInput: false },
      },
    });

    expect(updateProviderSettings).toHaveBeenCalledWith({
      provider_id: 'provider:1',
      patch: {
        models: {
          'model:known': { capabilities: { imageInput: false } },
          'model:custom': {},
        },
      },
    });
  });

  it('maps model editor fields into Settings-owned model configuration', async () => {
    const updateProviderSettings = vi.fn(() => ({
      status: 'updated' as const,
      provider: providerSettings(),
    }));
    const host = createSettingsHost({ updateProviderSettings } as never);

    await host.updateProvider({
      providerId: 'provider:1',
      models: [{
        modelId: 'model:1',
        displayName: 'Model One',
        contextWindowTokens: 131_072,
        imageInput: true,
      }],
    });

    expect(updateProviderSettings).toHaveBeenCalledWith({
      provider_id: 'provider:1',
      patch: {
        models: {
          'model:1': {
            display_name: 'Model One',
            context_window_tokens: 131_072,
            capabilities: { imageInput: true },
          },
        },
      },
    });
  });

  it('preserves Settings owner success statuses while projecting settings DTOs', async () => {
    const settings = resolvedSettings();
    const host = createSettingsHost({
      updateSettings: vi.fn(() => ({ status: 'updated' as const, settings })),
      completeSetup: vi.fn(() => ({ status: 'completed' as const, settings })),
      getWebSearchSettings: vi.fn(() => ({
        status: 'ok' as const,
        settings: { provider: 'brave' as const, has_api_key: true, credential_source: 'settings' as const },
      })),
    } as never);

    await expect(host.update({ theme: 'midnight-blue' })).resolves.toMatchObject({
      status: 'updated',
      settings: { theme: 'midnight-blue' },
    });
    await expect(host.completeSetup({ language: 'zh-CN' })).resolves.toMatchObject({
      status: 'completed',
      settings: { language: 'zh-CN' },
    });
  });

  it('preserves provider mutation owner statuses', async () => {
    const provider = providerSettings();
    const host = createSettingsHost({
      updateProviderSettings: vi.fn(() => ({ status: 'updated' as const, provider })),
      deleteProviderSettings: vi.fn(() => ({ status: 'deleted' as const, provider_id: 'provider:1' })),
      setProviderApiKey: vi.fn(() => ({ status: 'updated' as const, provider })),
      clearProviderApiKey: vi.fn(() => ({ status: 'updated' as const, provider })),
    } as never);

    await expect(host.updateProvider({ providerId: 'provider:1', displayName: 'DeepSeek' })).resolves.toMatchObject({
      status: 'updated',
      provider: { displayName: 'DeepSeek' },
    });
    await expect(host.deleteProvider({ providerId: 'provider:1' })).resolves.toEqual({
      status: 'deleted',
      providerId: 'provider:1',
    });
    await expect(host.setProviderApiKey({ providerId: 'provider:1', apiKey: 'secret' })).resolves.toMatchObject({
      status: 'updated',
      provider: { displayName: 'DeepSeek' },
    });
    await expect(host.deleteProviderApiKey({ providerId: 'provider:1' })).resolves.toMatchObject({
      status: 'updated',
      provider: { displayName: 'DeepSeek' },
    });
  });

  it('projects the Settings-owned provider catalog for the host UI', async () => {
    const host = createSettingsHost({
      listProviderSettings: vi.fn(() => ({ status: 'ok' as const, providers: [] })),
      listProviderCatalog: vi.fn(() => ({
        status: 'ok' as const,
        providers: [{
          providerId: 'DeepSeek',
          displayName: 'DeepSeek',
          protocol: 'openai-compatible' as const,
          defaultBaseUrl: 'https://api.deepseek.com',
          models: [{
            modelId: 'deepseek-v4-flash',
            displayName: 'DeepSeek V4 Flash',
            contextWindowTokens: 1_000_000,
            capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: false },
          }],
        }],
      })),
    } as never);

    await expect(host.listProviders()).resolves.toEqual({
      status: 'ok',
      providers: [],
      catalog: [{
        providerId: 'DeepSeek',
        displayName: 'DeepSeek',
        protocol: 'openai-compatible',
        defaultBaseUrl: 'https://api.deepseek.com',
        models: [{
          modelId: 'deepseek-v4-flash',
          displayName: 'DeepSeek V4 Flash',
          contextWindowTokens: 1_000_000,
          capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: false },
        }],
      }],
    });
  });
});

function resolvedSettings() {
  return {
    language: 'zh-CN' as const,
    theme: 'midnight-blue' as const,
    setup: { completed: true, completed_at: '2026-07-10T00:00:00.000Z' },
    memory: { enabled: false },
    context: { compaction_threshold_ratio: 0.8 },
    web: { search: {} },
    providers: {},
    permissions: { allow: [], ask: [], deny: [] },
  };
}

function providerSettings() {
  return {
    enabled: true,
    protocol: 'openai-compatible' as const,
    display_name: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    models: { 'deepseek-v4-flash': { context_window_tokens: 1_000_000 } },
  };
}
