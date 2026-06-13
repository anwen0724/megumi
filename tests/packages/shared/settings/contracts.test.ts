import { describe, expect, it } from 'vitest';
import {
  AppSettingsRawSchema,
  DEFAULT_APP_SETTINGS,
  resolveAppSettings,
} from '@megumi/shared/settings';

describe('app settings contracts', () => {
  it('resolves missing user settings from defaults without requiring a full settings file', () => {
    expect(resolveAppSettings({})).toEqual(DEFAULT_APP_SETTINGS);
    expect(resolveAppSettings({ theme: 'graphite-dark' })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      theme: 'graphite-dark',
    });
    expect(resolveAppSettings({
      compaction: {
        reserveTokens: 32768,
      },
    })).toEqual({
      ...DEFAULT_APP_SETTINGS,
      compaction: {
        ...DEFAULT_APP_SETTINGS.compaction,
        reserveTokens: 32768,
      },
    });
  });

  it('resolves provider, chat, and permission overrides from sparse settings', () => {
    expect(resolveAppSettings({
      chat: {
        defaultProvider: 'openai',
      },
      providers: {
        deepseek: {
          apiKey: 'sk-deepseek',
        },
        openai: {
          enabled: false,
          apiKeyEnv: 'CUSTOM_OPENAI_KEY',
        },
      },
      permissions: {
        ask: ['run_command(*)'],
      },
    })).toMatchObject({
      chat: {
        defaultProvider: 'openai',
      },
      providers: {
        deepseek: {
          enabled: true,
          kind: 'openai-compatible',
          displayName: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-v4-flash',
          apiKey: 'sk-deepseek',
          apiKeyEnv: 'DEEPSEEK_API_KEY',
        },
        openai: {
          enabled: false,
          kind: 'openai-compatible',
          displayName: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5.5',
          apiKeyEnv: 'CUSTOM_OPENAI_KEY',
        },
      },
      permissions: {
        ask: ['run_command(*)'],
      },
    });
  });

  it('keeps raw settings partial so disk files only express user overrides', () => {
    expect(AppSettingsRawSchema.parse({
      memory: {
        enabled: true,
      },
      providers: {
        deepseek: {
          apiKey: 'sk-deepseek',
        },
      },
    })).toEqual({
      memory: {
        enabled: true,
      },
      providers: {
        deepseek: {
          apiKey: 'sk-deepseek',
        },
      },
    });
  });
});
