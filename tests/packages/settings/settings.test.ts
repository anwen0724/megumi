/* Verifies the unified Settings capability across Provider, Model, Permission, and Web Search facts. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings as createFileSettings } from '@megumi/application/settings/settings-store';
import {
  DEFAULT_SETTINGS,
  createSettings,
  createRecordSettingsEnvironment,
  type SettingsStore,
} from '@megumi/application/settings/index';

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

const configurationDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of configurationDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Creates real, isolated files for the public configuration operations. */
function configurationFiles() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-settings-'));
  configurationDirectories.push(directory);
  const globalSettingsPath = path.join(directory, 'settings.json');
  const projectSettingsPath = path.join(directory, 'project', '.megumi', 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  return {
    directory,
    globalSettingsPath,
    projectSettingsPath,
    credentialsPath,
    settings: createFileSettings({
      globalSettingsPath,
      projectSettingsPath,
      credentialsPath,
      readEnvironment: () => undefined,
    }),
  };
}

describe('Configuration files', () => {
  it('leaves the original file intact when atomic replacement fails', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    const original = '{ "context": { "compactionThresholdRatio": 0.6 } }';
    fs.writeFileSync(files.projectSettingsPath, original);
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('Disk unavailable'); });
    expect(() => files.settings.updateSettings({
      patch: { context: { compactionThresholdRatio: 0.7 } }, expectedRevision: read.settings.revision,
    })).toThrow('Disk unavailable');
    expect(fs.readFileSync(files.projectSettingsPath, 'utf8')).toBe(original);
    expect(fs.readdirSync(path.dirname(files.projectSettingsPath))).toEqual(['settings.json']);
  });

  it('treats default model selection as one value and binds revisions to the configured files', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const first = files.settings.updateSettings({
      patch: { models: { defaultModel: { providerId: 'deepseek', modelId: 'first' } } },
      expectedRevision: read.settings.revision,
    });
    expect(first.status).toBe('updated');
    expect(files.settings.updateSettings({
      patch: { models: { defaultModel: { providerId: 'deepseek', modelId: 'second' } } },
      expectedRevision: read.settings.revision,
    })).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
    const other = configurationFiles();
    expect(other.settings.updateSettings({
      patch: { context: { compactionThresholdRatio: 0.6 } }, expectedRevision: read.settings.revision,
    })).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
  });

  it('preserves independent external edits but rejects changes to the same edited value', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ discovery: { recommendationTargetCount: 30 } }));
    expect(files.settings.updateSettings({
      patch: { discovery: { recommendationWorkingSetCount: 90 } },
      expectedRevision: read.settings.revision,
    })).toMatchObject({ status: 'updated', settings: { config: { discovery: { recommendationTargetCount: 30, recommendationWorkingSetCount: 90 } } } });
    const preserved = fs.readFileSync(files.projectSettingsPath, 'utf8');
    expect(files.settings.updateSettings({
      patch: { discovery: { recommendationTargetCount: 40 } },
      expectedRevision: read.settings.revision,
    })).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_CONFLICT' } });
    expect(fs.readFileSync(files.projectSettingsPath, 'utf8')).toBe(preserved);
  });

  it('rejects unknown edits and incomplete model selections without altering files', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    const request = JSON.parse('{"patch":{"context":{"undeclared":true}}}');
    request.expectedRevision = read.settings.revision;
    expect(files.settings.updateSettings(request)).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_INVALID' } });
    const incomplete = JSON.parse('{"patch":{"models":{"defaultModel":{"providerId":"deepseek"}}}}');
    incomplete.expectedRevision = read.settings.revision;
    expect(files.settings.updateSettings(incomplete).status).toBe('rejected');
    expect(fs.existsSync(files.projectSettingsPath)).toBe(false);
  });

  it('clears an explicit override through update while preserving unrelated unknown data', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ context: { compactionThresholdRatio: 0.6 } }));
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ context: { compactionThresholdRatio: 0.7, future: 42 } }));
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    expect(files.settings.updateSettings({
      patch: { context: { compactionThresholdRatio: null } },
      expectedRevision: read.settings.revision,
    })).toMatchObject({ status: 'updated', settings: { config: { context: { compactionThresholdRatio: 0.6 } } } });
    expect(JSON.parse(fs.readFileSync(files.projectSettingsPath, 'utf8'))).toEqual({ context: { future: 42 } });
  });

  it('saves only explicit changes to the bound file, including explicit defaults', () => {
    const files = configurationFiles();
    const read = files.settings.readSettings();
    if (read.status !== 'ok') throw new Error('Expected configuration');
    expect(files.settings.updateSettings({ patch: {}, expectedRevision: read.settings.revision }).status).toBe('unchanged');
    expect(fs.existsSync(files.projectSettingsPath)).toBe(false);
    expect(files.settings.updateSettings({
      patch: { context: { compactionThresholdRatio: 0.8 } },
      expectedRevision: read.settings.revision,
    }).status).toBe('updated');
    expect(JSON.parse(fs.readFileSync(files.projectSettingsPath, 'utf8'))).toEqual({ context: { compactionThresholdRatio: 0.8 } });
    expect(fs.existsSync(files.globalSettingsPath)).toBe(false);
  });

  it('requires an API URL for a custom search provider', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ webSearch: { provider: 'custom' } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_INVALID' } });
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ webSearch: { provider: 'custom', baseUrl: 'https://search.example/v1' } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'ok' });
  });

  it('requires complete custom definitions and validates model capacity after project overrides', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ models: { providers: { local: {} } } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_INVALID' } });
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ models: {
      providers: { local: { api: 'openai-completions', baseUrl: 'http://localhost:9999/v1' } },
      customModels: { local: { small: { contextWindowTokens: 8192, maxOutputTokens: 1024 } } },
    } }));
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ models: { customModels: { local: { small: { maxOutputTokens: 16384 } } } } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_INVALID' } });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ models: { customModels: { local: { small: { maxOutputTokens: 2048 } } } } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'ok', settings: { config: { models: {
      customModels: { local: { small: { contextWindowTokens: 8192, maxOutputTokens: 2048, enabled: true, capabilities: { toolCalls: 'unknown' } } } },
    } } } });
  });

  it('validates relationships after combining files rather than filling each file with defaults', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ discovery: {
      recommendationTargetCount: 20, recommendationWorkingSetCount: 40,
      candidatePoolMinimumCount: 20, candidatePoolMaximumCount: 60,
    } }));
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ discovery: { recommendationTargetCount: 50 } }));
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected', error: { code: 'SETTINGS_INVALID', issues: expect.arrayContaining([
        { path: ['discovery', 'recommendationTargetCount'], message: expect.any(String) },
      ]) },
    });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ discovery: { recommendationTargetCount: 35 } }));
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok', settings: { config: { discovery: { recommendationTargetCount: 35, recommendationWorkingSetCount: 40 } } },
    });
  });

  it('diagnoses unknown fields without disclosing or rewriting their contents', () => {
    const files = configurationFiles();
    const content = JSON.stringify({ general: { setupCompleted: true, token: 'private-value' }, future: { secret: 'another-value' } });
    fs.writeFileSync(files.globalSettingsPath, content);
    const read = files.settings.readSettings();
    expect(read).toMatchObject({
      status: 'ok',
      settings: { diagnostics: [
        { code: 'SETTINGS_UNKNOWN_FIELD', scope: 'global', path: ['general', 'token'] },
        { code: 'SETTINGS_UNKNOWN_FIELD', scope: 'global', path: ['future'] },
      ] },
    });
    expect(JSON.stringify(read)).not.toContain('private-value');
    expect(JSON.stringify(read)).not.toContain('another-value');
    expect(fs.readFileSync(files.globalSettingsPath, 'utf8')).toBe(content);
  });

  it('reports invalid fields and can reread a manually repaired file without rewriting it', () => {
    const files = configurationFiles();
    const invalid = '{ "context": { "compactionThresholdRatio": 0 } }';
    fs.writeFileSync(files.globalSettingsPath, invalid);
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: { code: 'SETTINGS_INVALID', issues: [{ scope: 'global', path: ['context', 'compactionThresholdRatio'] }] },
    });
    expect(fs.readFileSync(files.globalSettingsPath, 'utf8')).toBe(invalid);
    fs.writeFileSync(files.globalSettingsPath, '{ broken');
    expect(files.settings.readSettings()).toMatchObject({ status: 'rejected', error: { code: 'SETTINGS_INVALID' } });
    fs.writeFileSync(files.globalSettingsPath, '{ "context": { "compactionThresholdRatio": 0.65 } }');
    expect(files.settings.readSettings()).toMatchObject({ status: 'ok', settings: { config: { context: { compactionThresholdRatio: 0.65 } } } });
  });

  it('rejects forbidden project fields with their location', () => {
    const files = configurationFiles();
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({ general: { language: 'en-US' } }));
    expect(files.settings.readSettings()).toMatchObject({
      status: 'rejected',
      error: {
        code: 'SETTINGS_SCOPE_INVALID',
        issues: [{ scope: 'project', path: ['general', 'language'] }],
      },
    });
  });

  it('merges project fields over the latest global file while keeping each source', () => {
    const files = configurationFiles();
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({
      general: { setupCompleted: true },
      models: {
        defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        providers: { deepseek: { baseUrl: 'https://global.example/v1' } },
      },
      discovery: { enabledSources: ['bilibili'] },
    }));
    fs.mkdirSync(path.dirname(files.projectSettingsPath), { recursive: true });
    fs.writeFileSync(files.projectSettingsPath, JSON.stringify({
      models: { providers: { deepseek: { baseUrl: 'https://project.example/v1', enabled: false } } },
      discovery: { enabledSources: [] },
    }));
    const read = files.settings.readSettings();
    expect(read).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { setupCompleted: true },
          models: {
            defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
            providers: { deepseek: { baseUrl: 'https://project.example/v1', enabled: false } },
          },
          discovery: { enabledSources: [] },
        },
        sources: expect.arrayContaining([
          { path: ['general', 'setupCompleted'], source: 'global' },
          { path: ['models', 'providers', 'deepseek', 'baseUrl'], source: 'project' },
          { path: ['context', 'compactionThresholdRatio'], source: 'default' },
        ]),
      },
    });
    fs.writeFileSync(files.globalSettingsPath, JSON.stringify({ general: { setupCompleted: false } }));
    expect(files.settings.readSettings()).toMatchObject({ status: 'ok', settings: { config: { general: { setupCompleted: false } } } });
  });

  it('reads complete defaults without creating missing configuration files', () => {
    const files = configurationFiles();
    expect(files.settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          general: { language: 'zh-CN', theme: 'midnight-blue', setupCompleted: false },
          models: { providers: {}, customModels: {}, modelOverrides: {} },
          context: { compactionThresholdRatio: 0.8 },
          discovery: { recommendationTargetCount: 20, enabledSources: ['bilibili', 'open_web'] },
          voice: { inputDeviceId: 'default', outputDeviceId: 'default', readAloudEnabled: false },
          webSearch: {},
          permissions: { mode: 'ask', allow: [], ask: [], deny: [] },
        },
      },
    });
    expect(fs.readdirSync(files.directory)).toEqual([]);
  });
});

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

  it('records the wizard-selected default model when setup includes a provider', () => {
    const store = new MemorySettingsStore();
    const settings = createSettings({ store });
    const result = settings.completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      provider: {
        provider_id: 'deepseek',
        enabled: true,
        models: ['deepseek-v4-flash'],
        api_key: 'TEST_SETUP_API_KEY',
      },
    });
    expect(result).toMatchObject({ status: 'completed' });
    expect(store.document.model_selection).toEqual({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    });
    expect(result.status === 'completed' ? result.settings.model_selection : undefined).toEqual({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    });
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
        'deepseek-flash': { capabilities: { imageInput: true, thinking: 'unknown' } },
      } },
    })).toMatchObject({ status: 'updated' });

    expect(store.document.providers.deepseek.models['deepseek-flash']).toEqual({
      context_window_tokens: 1_000_000,
      max_output_tokens: 384_000,
      capabilities: { imageInput: true, thinking: 'unknown' },
    });
    expect(settings.resolveProvider({
      provider_id: 'deepseek',
      model_id: 'deepseek-flash',
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
        'deepseek-flash': { context_window_tokens: 2_000_000 },
      } } },
    };
    const settings = createSettings({ store });
    expect(settings.resolveModel({
      provider_id: 'deepseek',
      model_id: 'deepseek-flash',
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
