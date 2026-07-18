// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettingsService,
  DEFAULT_SETTINGS,
  type SettingsRaw,
} from '@megumi/agent/settings';

class MemorySettingsFileStore {
  raw: SettingsRaw = {};

  readRawSettings(): SettingsRaw {
    return this.raw;
  }

  writeRawSettings(next: SettingsRaw): void {
    this.raw = next;
  }
}

describe('Settings Service', () => {
  it('resolves the selected web search provider and credential dynamically', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore, env: { TAVILY_API_KEY: 'env-secret' } });
    expect(service.resolveWebSearchRuntimeConfig()).toEqual({ status: 'unconfigured' });

    service.updateSettings({ patch: { web: { search: { provider: 'tavily' } } } });
    expect(service.getWebSearchSettings()).toEqual({
      status: 'ok',
      settings: {
        provider: 'tavily',
        has_api_key: true,
        credential_source: 'environment',
        api_key_env: 'TAVILY_API_KEY',
      },
    });
    expect(service.resolveWebSearchRuntimeConfig()).toEqual({
      status: 'configured',
      config: { provider: 'tavily', api_key: 'env-secret' },
    });
  });

  it('requires a Base URL for a custom search provider and clears stored keys', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore });
    service.updateSettings({ patch: { web: { search: { provider: 'custom', api_key: 'secret' } } } });
    expect(service.resolveWebSearchRuntimeConfig()).toEqual({ status: 'unconfigured' });

    service.updateSettings({ patch: { web: { search: { base_url: 'https://search.example.com/query' } } } });
    expect(service.resolveWebSearchRuntimeConfig()).toMatchObject({ status: 'configured' });
    service.updateSettings({ patch: { web: { search: { api_key: null } } } });
    expect(fileStore.raw.web?.search).not.toHaveProperty('api_key');
    expect(service.resolveWebSearchRuntimeConfig()).toEqual({ status: 'unconfigured' });
  });
  it('returns raw settings from the file store', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      memory: {
        enabled: true,
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.getRawSettings()).toEqual({
      status: 'ok',
      settings: {
        memory: {
          enabled: true,
        },
      },
    });
  });

  it('returns resolved settings with defaults', () => {
    const service = createSettingsService({ file_store: new MemorySettingsFileStore() });

    expect(service.getResolvedSettings()).toEqual({
      status: 'ok',
      settings: DEFAULT_SETTINGS,
    });
    expect(DEFAULT_SETTINGS).not.toHaveProperty('compaction');
  });

  it('rejects removed user-facing compaction settings', () => {
    const service = createSettingsService({ file_store: new MemorySettingsFileStore() });

    expect(service.updateSettings({
      patch: {
        compaction: {
          enabled: true,
          reserve_tokens: 16_384,
          keep_recent_tokens: 20_000,
        },
      },
    } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'settings_patch_invalid' },
    });
  });

  it('updates settings while materializing the default Context policy', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore });

    const result = service.updateSettings({
      patch: {
        memory: {
          enabled: true,
        },
      },
    });

    expect(fileStore.raw).toEqual({
      context: {
        compaction_threshold_ratio: 0.8,
      },
      memory: {
        enabled: true,
      },
    });
    expect(result).toMatchObject({
      status: 'updated',
      settings: {
        memory: {
          enabled: true,
        },
      },
    });
  });

  it('completes setup using the settings owner clock', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({
      file_store: fileStore,
      now: () => '2026-07-10T00:00:00.000Z',
    });

    const result = service.completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
    });

    expect(fileStore.raw).toEqual({
      context: {
        compaction_threshold_ratio: 0.8,
      },
      language: 'zh-CN',
      theme: 'midnight-blue',
      setup: {
        completed: true,
        completed_at: '2026-07-10T00:00:00.000Z',
      },
    });
    expect(result).toEqual({
      status: 'completed',
      settings: expect.objectContaining({
        setup: {
          completed: true,
          completed_at: '2026-07-10T00:00:00.000Z',
        },
      }),
    });
  });

  it('lists provider settings with the locally configured API key for the settings UI', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        deepseek: {
          api_key: 'TEST_DEEPSEEK_API_KEY',
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    const result = service.listProviderSettings();

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const deepseek = result.providers.find((provider) => provider.provider_id === 'deepseek');
    expect(deepseek).toMatchObject({
      provider_id: 'deepseek',
      display_name: 'DeepSeek',
      enabled: true,
      has_api_key: true,
      api_key: 'TEST_DEEPSEEK_API_KEY',
      credential_source: 'settings',
    });
  });

  it('materializes a catalog provider when the user only saves an API key', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore });

    expect(service.setProviderApiKey({
      provider_id: 'DeepSeek',
      api_key: 'TEST_DEEPSEEK_API_KEY',
    })).toMatchObject({ status: 'updated' });

    expect(fileStore.raw).toEqual({
      context: { compaction_threshold_ratio: 0.8 },
      providers: {
        DeepSeek: {
          enabled: true,
          protocol: 'openai-compatible',
          display_name: 'DeepSeek',
          base_url: 'https://api.deepseek.com',
          models: {
            'deepseek-v4-flash': {
              context_window_tokens: 1_000_000,
            },
            'deepseek-v4-pro': {
              context_window_tokens: 1_000_000,
            },
          },
          api_key: 'TEST_DEEPSEEK_API_KEY',
        },
      },
    });
  });

  it('keeps model capability overrides sparse while resolving a complete effective capability set', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore });
    service.setProviderApiKey({ provider_id: 'DeepSeek', api_key: 'TEST_DEEPSEEK_API_KEY' });

    expect(service.updateProviderSettings({
      provider_id: 'DeepSeek',
      patch: {
        models: {
          'deepseek-v4-flash': { capabilities: { imageInput: true, thinking: 'unknown' } },
        },
      },
    })).toMatchObject({ status: 'updated' });

    expect(fileStore.raw.providers?.DeepSeek?.models?.['deepseek-v4-flash']).toEqual({
      context_window_tokens: 1_000_000,
      capabilities: { imageInput: true, thinking: 'unknown' },
    });
    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'DeepSeek',
      model_id: 'deepseek-v4-flash',
    })).toMatchObject({
      status: 'ok',
      config: {
        capabilities: {
          streaming: true,
          toolCalls: true,
          thinking: 'unknown',
          imageInput: true,
        },
      },
    });
    expect(service.listProviderSettings()).toMatchObject({
      status: 'ok',
      providers: [{
        model_capability_overrides: {
          'deepseek-v4-flash': { imageInput: true, thinking: 'unknown' },
        },
      }],
    });
  });

  it('uses catalog facts to resolve manually removed provider fields', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        DeepSeek: {
          enabled: true,
          api_key: 'TEST_DEEPSEEK_API_KEY',
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'DeepSeek',
      model_id: 'deepseek-v4-flash',
    })).toEqual({
      status: 'ok',
      config: {
        provider_id: 'DeepSeek',
        protocol: 'openai-compatible',
        base_url: 'https://api.deepseek.com',
        model_id: 'deepseek-v4-flash',
        api_key: 'TEST_DEEPSEEK_API_KEY',
        capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: false },
      },
    });
  });

  it('caps a configured Context Window at the catalog model maximum', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      context: { compaction_threshold_ratio: 0.7 },
      providers: {
        DeepSeek: {
          models: {
            'deepseek-v4-flash': { context_window_tokens: 2_000_000 },
          },
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.resolveModelContextSettings({
      provider_id: 'DeepSeek',
      model_id: 'deepseek-v4-flash',
    })).toEqual({
      status: 'ok',
      context: {
        context_window_tokens: 1_000_000,
        compaction_threshold_ratio: 0.7,
      },
    });
  });

  it('deletes configured provider settings', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        deepseek: {
          enabled: true,
          base_url: 'https://api.deepseek.com/v1',
          models: { 'deepseek-chat': {} },
        },
        local: {
          enabled: true,
          base_url: 'http://localhost:11434/v1',
          models: { llama3: {} },
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.deleteProviderSettings({ provider_id: 'deepseek' })).toEqual({
      status: 'deleted',
      provider_id: 'deepseek',
    });
    expect(fileStore.raw.providers).toEqual({
      local: {
        enabled: true,
        base_url: 'http://localhost:11434/v1',
        models: { llama3: {} },
      },
    });
  });

  it('lists enabled provider model options with provider and model ids', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        local: {
          enabled: true,
          protocol: 'openai-compatible',
          display_name: 'Local',
          base_url: 'http://localhost:11434/v1',
          models: { llama3: { display_name: 'Llama 3 Local' }, qwen3: {} },
          api_key: 'sk-local',
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.listAvailableModels()).toEqual({
      status: 'ok',
      models: expect.arrayContaining([
        {
          provider_id: 'local',
          model_id: 'llama3',
          display_name: 'Llama 3 Local',
          capabilities: { streaming: 'unknown', toolCalls: 'unknown', thinking: 'unknown', imageInput: 'unknown' },
        },
        {
          provider_id: 'local',
          model_id: 'qwen3',
          display_name: 'qwen3',
          capabilities: { streaming: 'unknown', toolCalls: 'unknown', thinking: 'unknown', imageInput: 'unknown' },
        },
      ]),
    });
  });

  it('resolves provider runtime config for an enabled configured model', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        local: {
          enabled: true,
          protocol: 'openai-compatible',
          display_name: 'Local',
          base_url: 'http://localhost:11434/v1',
          models: { llama3: {} },
          api_key: 'sk-local',
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'local',
      model_id: 'llama3',
    })).toEqual({
      status: 'ok',
      config: {
        provider_id: 'local',
        protocol: 'openai-compatible',
        base_url: 'http://localhost:11434/v1',
        model_id: 'llama3',
        api_key: 'sk-local',
        capabilities: { streaming: 'unknown', toolCalls: 'unknown', thinking: 'unknown', imageInput: 'unknown' },
      },
    });
  });

  it('returns failed runtime config results for invalid provider selections', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        missing_key: {
          enabled: true,
          protocol: 'openai-compatible',
          display_name: 'Missing key',
          base_url: 'http://localhost:11434/v1',
          models: { llama3: {} },
        },
        disabled: {
          enabled: false,
          protocol: 'openai-compatible',
          display_name: 'Disabled',
          base_url: 'http://localhost:11434/v1',
          models: { llama3: {} },
          api_key: 'TEST_DISABLED_API_KEY',
        },
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'missing_key',
      model_id: 'llama3',
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'provider_missing_api_key',
      },
    });
    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'disabled',
      model_id: 'llama3',
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'provider_disabled',
      },
    });
    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'unknown',
      model_id: 'llama3',
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'provider_unknown',
      },
    });
    expect(service.resolveProviderRuntimeConfig({
      provider_id: 'missing_key',
      model_id: 'unknown-model',
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'provider_model_unknown',
      },
    });
  });

  it('filters permission settings by user, workspace, and session sources', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      permissions: {
        allow: [
          { source: 'user', pattern: 'tool:read_file|path=*' },
          { source: 'workspace', source_id: 'workspace_1', pattern: 'tool:write_file|path=src/index.ts' },
          { source: 'workspace', source_id: 'workspace_2', pattern: 'tool:write_file|path=src/other.ts' },
          { source: 'session', source_id: 'session_1', pattern: 'tool:run_command|command=npm test' },
          { source: 'session', source_id: 'session_2', pattern: 'tool:run_command|command=npm lint' },
        ],
      },
    };
    const service = createSettingsService({ file_store: fileStore });

    expect(service.resolvePermissionSettings({
      workspace_id: 'workspace_1',
      session_id: 'session_1',
    })).toEqual({
      status: 'ok',
      permission_settings: {
        allow: [
          { source: 'user', pattern: 'tool:read_file|path=*' },
          { source: 'workspace', source_id: 'workspace_1', pattern: 'tool:write_file|path=src/index.ts' },
          { source: 'session', source_id: 'session_1', pattern: 'tool:run_command|command=npm test' },
        ],
        ask: [],
        deny: [],
      },
    });
  });

  it('adds session permission rules to sparse raw settings', () => {
    const fileStore = new MemorySettingsFileStore();
    const service = createSettingsService({ file_store: fileStore });

    const result = service.addPermissionRule({
      session_id: 'session_1',
      rule: {
        source: 'session',
        source_id: 'session_1',
        pattern: 'tool:run_command|command=npm test',
      },
    });

    expect(result.status).toBe('saved');
    expect(fileStore.raw).toEqual({
      permissions: {
        allow: [
          {
            source: 'session',
            source_id: 'session_1',
            pattern: 'tool:run_command|command=npm test',
          },
        ],
      },
    });
  });

  it('rejects session permission rules when request session id does not match rule source id', () => {
    const service = createSettingsService({ file_store: new MemorySettingsFileStore() });

    expect(service.addPermissionRule({
      session_id: 'session_1',
      rule: {
        source: 'session',
        source_id: 'session_2',
        pattern: 'tool:run_command|command=npm test',
      },
    })).toMatchObject({
      status: 'failed',
      failure: {
        code: 'permission_session_mismatch',
      },
    });
  });
});
