// @vitest-environment node
/* Protects the one-time Provider API migration without widening current Settings contracts. */
import { describe, expect, it } from 'vitest';
import { migrateLegacyProviderApiSettings } from '@megumi/product/migrations/legacy-provider-api-settings';

describe('legacy provider API settings migration', () => {
  it('migrates legacy protocols while preserving current user settings', () => {
    const value = {
      language: 'zh-CN',
      theme: 'midnight-blue',
      setup: {
        completed: true,
        completed_at: '2026-07-14T14:37:55.944Z',
      },
      model_selection: {
        provider_id: 'custom',
        model_id: 'custom-chat',
      },
      providers: {
        custom: {
          enabled: true,
          protocol: 'openai-compatible',
          display_name: 'Custom Provider',
          base_url: 'https://example.com/v1',
          models: { 'custom-chat': {} },
          api_key: 'preserved-secret',
        },
        anthropic: {
          protocol: 'anthropic',
          models: { 'claude-test': {} },
        },
      },
    };

    expect(migrateLegacyProviderApiSettings(value)).toEqual({
      migrated: true,
      settings: {
        ...value,
        providers: {
          custom: {
            enabled: true,
            api: 'openai-completions',
            display_name: 'Custom Provider',
            base_url: 'https://example.com/v1',
            models: { 'custom-chat': {} },
            api_key: 'preserved-secret',
          },
          anthropic: {
            api: 'anthropic-messages',
            models: { 'claude-test': {} },
          },
        },
      },
    });
  });
});
