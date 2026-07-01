import { describe, expect, it } from 'vitest';
import {
  AppSettingsRawSchema,
  createAppSettingsJsonSchema,
  DEFAULT_APP_SETTINGS,
  mergeRawAppSettings,
  resolveAppSettings,
} from '@megumi/coding-agent/settings';

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

  it('resolves language and first-run setup defaults', () => {
    expect(resolveAppSettings({})).toMatchObject({
      language: 'zh-CN',
      setup: {
        completed: false,
      },
    });

    expect(resolveAppSettings({
      language: 'en-US',
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
      },
    })).toMatchObject({
      language: 'en-US',
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
      },
    });
  });

  it('merges setup completion without expanding sparse raw settings', () => {
    expect(mergeRawAppSettings({
      theme: 'midnight-blue',
    }, {
      language: 'en-US',
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
      },
    })).toEqual({
      theme: 'midnight-blue',
      language: 'en-US',
      setup: {
        completed: true,
        completedAt: '2026-06-29T12:00:00.000Z',
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

  it('uses null patches to remove direct and environment API key overrides', () => {
    const merged = mergeRawAppSettings({
      providers: {
        deepseek: {
          apiKey: 'sk-deepseek',
          apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
        },
      },
    }, {
      providers: {
        deepseek: {
          apiKey: null,
          apiKeyEnv: null,
        },
      },
    });

    expect(merged).toEqual({
      providers: {
        deepseek: {},
      },
    });
  });

  it('generates editor JSON Schema from the raw settings contract', () => {
    const jsonSchema = createAppSettingsJsonSchema();

    expect(jsonSchema).toMatchObject({
      title: 'Megumi settings',
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual(AppSettingsRawSchema.keyof().options);
    expect(jsonSchema.properties?.theme).toEqual({
      enum: ['megumi-warm', 'neutral-light', 'graphite-dark', 'sage-mist', 'midnight-blue'],
    });
    expect(jsonSchema.properties?.language).toEqual({
      enum: ['zh-CN', 'en-US'],
    });
    expect(jsonSchema.properties?.setup).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        completed: { type: 'boolean' },
        completedAt: { type: 'string' },
      },
    });
    expect(jsonSchema.properties?.providers).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        deepseek: {
          type: 'object',
          additionalProperties: false,
          properties: {
            apiKey: { type: ['string', 'null'], minLength: 1 },
            apiKeyEnv: { type: ['string', 'null'], minLength: 1 },
          },
        },
        custom: {
          type: 'object',
          additionalProperties: false,
        },
      },
    });
    expect(jsonSchema.properties?.permissions).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        allow: { type: 'array' },
        ask: { type: 'array' },
        deny: { type: 'array' },
      },
    });
  });
});

