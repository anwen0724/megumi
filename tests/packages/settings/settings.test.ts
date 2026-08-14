/* Verifies the unified Settings capability across Provider, Model, Permission, and Web Search facts. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  createSettings,
  createRecordSettingsEnvironment,
  type SettingsStore,
} from '../../../packages/settings/src';

class MemorySettingsStore implements SettingsStore {
  document: Record<string, any> = {};
  writeFailure?: Error;

  read(): unknown {
    return structuredClone(this.document);
  }

  write(next: Readonly<Record<string, unknown>>): void {
    if (this.writeFailure) throw this.writeFailure;
    this.document = structuredClone(next);
  }
}

describe('Settings', () => {
  it('resolves Web Search public settings and environment credentials separately', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({
      store,
      environment: createRecordSettingsEnvironment({ TAVILY_API_KEY: 'env-secret' }),
    });
    expect(settings.resolveWebSearch()).toEqual({
      status: 'ok',
      settings: { has_api_key: false, credential_source: 'missing' },
    });

    settings.update({ patch: { web: { search: { provider: 'tavily' } } } });
    expect(settings.resolveWebSearch()).toEqual({
      status: 'ok',
      settings: {
        provider: 'tavily',
        api_key_env: 'TAVILY_API_KEY',
        has_api_key: true,
        credential_source: 'environment',
      },
    });
    expect(settings.readWebSearchApiKey({})).toEqual({
      status: 'found', api_key: 'env-secret', source: 'environment', env_name: 'TAVILY_API_KEY',
    });
  });

  it('requires a Base URL for custom search configuration and uses explicit key deletion', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    settings.update({ patch: { web: { search: { provider: 'custom' } } } });
    settings.writeWebSearchApiKey({ api_key: 'secret' });
    expect(settings.resolveWebSearch()).toMatchObject({
      status: 'ok',
      settings: { provider: 'custom', has_api_key: true },
    });
    settings.update({ patch: { web: { search: { base_url: 'https://search.example.com/query' } } } });
    expect(settings.resolveWebSearch()).toMatchObject({
      status: 'ok',
      settings: { base_url: 'https://search.example.com/query' },
    });
    settings.deleteWebSearchApiKey({});
    expect(store.document.web.search).not.toHaveProperty('api_key');
  });

  it('returns secret-free raw settings and resolves defaults', () => {
    const store = new MemorySettingsStore();
    store.document = {
      memory: { enabled: true },
      providers: { local: { api_key: 'secret' } },
    };
    const settings = createSettings({ store });
    const read = settings.read();
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.settings).toEqual({ memory: { enabled: true }, providers: { local: {} } });
    const resolved = settings.resolve();
    expect(resolved.status).toBe('ok');
    if (resolved.status !== 'ok') return;
    expect(resolved.settings).toMatchObject({ ...DEFAULT_SETTINGS, memory: { enabled: true } });
    expect(resolved.settings).not.toHaveProperty('compaction');
  });

  it('persists the audio input device and recognition language while resolving safe defaults for old files', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });

    expect(settings.resolve()).toMatchObject({
      status: 'ok',
      settings: {
        voice: {
          input_device_id: 'default',
          recognition_language: 'auto',
        },
      },
    });

    expect(settings.update({ patch: {
      voice: {
        input_device_id: 'microphone-2',
        recognition_language: 'zh',
      },
    } })).toMatchObject({ status: 'updated' });
    expect(store.document.voice).toEqual({
      input_device_id: 'microphone-2',
      recognition_language: 'zh',
    });
  });

  it('resolves output device, read-aloud and tts preferences as current voice fields', () => {
    const store = new MemorySettingsStore();
    store.document = {
      voice: {
        input_device_id: 'microphone-1',
        output_device_id: 'speaker-1',
        recognition_language: 'auto',
        read_aloud_enabled: true,
        tts: { provider: 'minimax', voice_id: 'qiaopi_mengmei' },
      },
    } as never;
    const settings = createSettings({ store });

    expect(settings.resolve()).toMatchObject({
      status: 'ok',
      settings: {
        voice: {
          input_device_id: 'microphone-1',
          output_device_id: 'speaker-1',
          recognition_language: 'auto',
          read_aloud_enabled: true,
          tts: {
            provider: 'minimax',
            voice_id: 'qiaopi_mengmei',
            has_api_key: false,
            credential_source: 'missing',
          },
        },
      },
    });
  });

  it('persists output device, read-aloud toggle and tts preferences through the public patch', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });

    expect(settings.update({ patch: {
      voice: {
        output_device_id: 'speaker-2',
        read_aloud_enabled: true,
        tts: { provider: 'minimax', voice_id: 'female-tianmei' },
      },
    } })).toMatchObject({ status: 'updated' });
    expect(store.document.voice).toMatchObject({
      output_device_id: 'speaker-2',
      read_aloud_enabled: true,
      tts: { provider: 'minimax', voice_id: 'female-tianmei' },
    });
  });

  it('rejects removed compaction settings and materializes Context defaults', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    expect(settings.update({ patch: {
      compaction: { enabled: true, reserve_tokens: 16_384 },
    } } as never)).toMatchObject({
      status: 'failed',
      failure: { code: 'config_invalid', details: { settings_code: 'settings_patch_invalid' } },
    });
    expect(settings.update({ patch: { memory: { enabled: true } } })).toMatchObject({ status: 'updated' });
    expect(store.document).toEqual({
      context: { compaction_threshold_ratio: 0.8 },
      memory: { enabled: true },
    });
  });

  it('completes setup using the Settings clock', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({
      store,
      now: () => '2026-07-10T00:00:00.000Z',
    });
    expect(settings.completeSetup({ language: 'zh-CN', theme: 'midnight-blue' })).toMatchObject({
      status: 'completed',
      settings: { setup: { completed: true, completed_at: '2026-07-10T00:00:00.000Z' } },
    });
    expect(store.document.setup).toEqual({
      completed: true,
      completed_at: '2026-07-10T00:00:00.000Z',
    });
  });

  it('persists a provider API key supplied during setup through the credential path', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    const result = settings.completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      provider: {
        provider_id: 'deepseek',
        enabled: true,
        api_key: 'TEST_SETUP_API_KEY',
      },
    });
    expect(result).toMatchObject({ status: 'completed' });
    expect(JSON.stringify(result)).not.toContain('TEST_SETUP_API_KEY');
    expect(store.document.providers.deepseek).toMatchObject({
      api_key: 'TEST_SETUP_API_KEY',
    });
    expect(settings.listProviders()).toMatchObject({
      status: 'ok',
      providers: [{ provider_id: 'deepseek', has_api_key: true, credential_source: 'settings' }],
    });
    expect(JSON.stringify(settings.listProviders())).not.toContain('TEST_SETUP_API_KEY');
  });

  it('materializes catalog provider defaults when only an API key is written', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    expect(settings.writeProviderApiKey({
      provider_id: 'deepseek',
      api_key: 'TEST_DEEPSEEK_API_KEY',
    })).toEqual({ status: 'updated' });
    expect(store.document.providers.deepseek).toMatchObject({
      api_key: 'TEST_DEEPSEEK_API_KEY',
      enabled: true,
      api: 'openai-completions',
      display_name: 'DeepSeek',
      base_url: 'https://api.deepseek.com',
    });
    expect(settings.listProviders()).toMatchObject({
      status: 'ok',
      providers: [{ provider_id: 'deepseek', has_api_key: true, credential_source: 'settings' }],
    });
    expect(JSON.stringify(settings.listProviders())).not.toContain('TEST_DEEPSEEK_API_KEY');
  });

  it('keeps capability overrides sparse and resolves AI-owned capability facts', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    settings.writeProviderApiKey({ provider_id: 'deepseek', api_key: 'TEST_DEEPSEEK_API_KEY' });
    expect(settings.updateProvider({
      provider_id: 'deepseek',
      patch: { models: {
        'deepseek-v4-flash': { capabilities: { imageInput: true, thinking: 'unknown' } },
      } },
    })).toMatchObject({ status: 'updated' });

    expect(store.document.providers.deepseek.models['deepseek-v4-flash']).toEqual({
      context_window_tokens: 1_000_000,
      max_output_tokens: 384_000,
      capabilities: { imageInput: true, thinking: 'unknown' },
    });
    expect(settings.resolveProvider({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    })).toMatchObject({
      status: 'ok',
      config: {
        capabilities: { streaming: true, toolCalls: true, thinking: 'unknown', imageInput: true },
      },
    });
    expect(settings.readProviderApiKey({ provider_id: 'deepseek' })).toEqual({
      status: 'found', api_key: 'TEST_DEEPSEEK_API_KEY', source: 'settings',
    });
  });

  it('caps Context capacity at the AI catalog maximum', () => {
    const store = new MemorySettingsStore();
    store.document = {
      context: { compaction_threshold_ratio: 0.7 },
      providers: { deepseek: { models: {
        'deepseek-v4-flash': { context_window_tokens: 2_000_000 },
      } } },
    };
    const settings = createSettings({ store });
    expect(settings.resolveModel({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    })).toEqual({
      status: 'ok',
      context: { context_window_tokens: 1_000_000, compaction_threshold_ratio: 0.7 },
    });
  });

  it('lists model choices, resolves provider config without secrets, and deletes providers', () => {
    const store = new MemorySettingsStore();
    store.document = { providers: {
      local: {
        enabled: true,
        api: 'openai-completions',
        display_name: 'Local',
        base_url: 'http://localhost:11434/v1',
        models: { llama3: { display_name: 'Llama 3 Local' }, qwen3: {} },
        api_key: 'sk-local',
      },
    } };
    const settings = createSettings({ store });
    expect(settings.listAvailableModels()).toMatchObject({
      status: 'ok',
      models: expect.arrayContaining([
        expect.objectContaining({ provider_id: 'local', model_id: 'llama3', display_name: 'Llama 3 Local' }),
      ]),
    });
    const resolved = settings.resolveProvider({ provider_id: 'local', model_id: 'llama3' });
    expect(resolved).toMatchObject({
      status: 'ok',
      config: { provider_id: 'local', model_id: 'llama3', context_window_tokens: 256_000 },
    });
    expect(JSON.stringify(resolved)).not.toContain('sk-local');
    expect(settings.deleteProvider({ provider_id: 'local' })).toEqual({
      status: 'deleted', provider_id: 'local',
    });
    expect(store.document.providers).toEqual({});
  });

  it('returns RuntimeError failures for invalid Provider selections', () => {
    const store = new MemorySettingsStore();
    store.document = { providers: {
      disabled: {
        enabled: false,
        base_url: 'http://localhost:11434/v1',
        models: { llama3: {} },
      },
    } };
    const settings = createSettings({ store });
    expect(settings.resolveProvider({ provider_id: 'disabled', model_id: 'llama3' })).toMatchObject({
      status: 'failed',
      failure: { code: 'provider_disabled', source: 'config', details: { settings_code: 'provider_disabled' } },
    });
    expect(settings.resolveProvider({ provider_id: 'unknown', model_id: 'llama3' })).toMatchObject({
      status: 'failed',
      failure: { code: 'config_invalid', details: { settings_code: 'provider_unknown' } },
    });
  });

  it('filters, adds, deduplicates, and removes Permission-owned rules', () => {
    const rule = (source: 'user' | 'workspace' | 'session', sourceId?: string, tool = 'run_command') => ({
      source,
      ...(sourceId ? { source_id: sourceId } : {}),
      target: { kind: 'tool' as const, tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: tool } },
    });
    const store = new MemorySettingsStore();
    store.document = { permissions: { mode: 'auto', allow: [
      rule('user', undefined, 'read_file'),
      rule('workspace', 'workspace_1', 'write_file'),
      rule('workspace', 'workspace_2', 'write_file'),
      rule('session', 'session_1'),
    ] } };
    const settings = createSettings({ store });
    const resolved = settings.resolvePermissions({ workspace_id: 'workspace_1', session_id: 'session_1' });
    expect(resolved.status).toBe('ok');
    if (resolved.status !== 'ok') return;
    expect(resolved.settings.allow).toEqual([
        rule('user', undefined, 'read_file'),
        rule('workspace', 'workspace_1', 'write_file'),
        rule('session', 'session_1'),
      ]);

    const sessionRule = rule('session', 'session_1');
    expect(settings.recordSessionPermissionGrant({ session_id: 'session_1', rules: [sessionRule, sessionRule] }).status)
      .toBe('saved');
    expect(settings.recordSessionPermissionGrant({ session_id: 'session_2', rules: [sessionRule] })).toMatchObject({
      status: 'failed',
      failure: { details: { settings_code: 'permission_session_mismatch' } },
    });
    expect(settings.changePermissionRules({
      operation: 'remove', effect: 'allow', rules: [sessionRule], session_id: 'session_1',
    }).status).toBe('saved');
  });

  it('normalizes write failures to retryable filesystem RuntimeErrors', () => {
    const store = new MemorySettingsStore();
    store.writeFailure = new Error('disk unavailable');
    const settings = createSettings({ store });
    const result = settings.recordSessionPermissionGrant({ session_id: 'session_1', rules: [{
      source: 'session',
      source_id: 'session_1',
      target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } },
    }] });
    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'filesystem_error', source: 'filesystem', retryable: true,
        details: { settings_code: 'settings_write_failed' },
      },
    });
  });
});
