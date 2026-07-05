// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettingsService,
  DEFAULT_SETTINGS,
  type SettingsRaw,
} from '@megumi/coding-agent/settings';

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
  });

  it('updates settings by writing sparse raw settings', () => {
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

  it('lists provider settings without leaking plaintext API keys', () => {
    const fileStore = new MemorySettingsFileStore();
    fileStore.raw = {
      providers: {
        deepseek: {
          api_key: 'sk-deepseek',
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
      display_name: 'deepseek',
      enabled: false,
      has_api_key: true,
      credential_source: 'settings',
    });
    expect(JSON.stringify(result.providers)).not.toContain('sk-deepseek');
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
          models: ['llama3', 'qwen3'],
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
          display_name: 'llama3',
        },
        {
          provider_id: 'local',
          model_id: 'qwen3',
          display_name: 'qwen3',
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
          models: ['llama3'],
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
          models: ['llama3'],
        },
        disabled: {
          enabled: false,
          protocol: 'openai-compatible',
          display_name: 'Disabled',
          base_url: 'http://localhost:11434/v1',
          models: ['llama3'],
          api_key: 'sk-disabled',
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
