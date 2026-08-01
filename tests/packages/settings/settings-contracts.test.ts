/* Verifies public Settings contracts, defaults, and editor schema generation. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  PermissionRuleSchema,
  ResolveProviderSettingsRequestSchema,
  SettingsRawSchema,
  createSettings,
  createSettingsJsonSchema,
  type SettingsStore,
} from '../../../packages/settings/src';

describe('Settings contracts', () => {
  it('accepts sparse secret-free raw settings and resolves defaults', () => {
    expect(SettingsRawSchema.parse({})).toEqual({});
    expect(createSettings({ store: memoryStore() }).resolve()).toEqual(DEFAULT_SETTINGS);
    expect(SettingsRawSchema.safeParse({
      providers: { deepseek: { api_key: 'must-not-be-public' } },
    }).success).toBe(false);
  });

  it('merges sparse patches and materializes provider defaults without losing file keys', () => {
    const store = memoryStore({
      theme: 'midnight-blue',
      providers: { deepseek: { api_key: 'TEST_DEEPSEEK_API_KEY' } },
    });
    const settings = createSettings({ store });

    settings.update({ patch: {
      language: 'en-US',
      memory: { enabled: true },
      providers: { deepseek: { enabled: false } },
    } });

    expect(store.document).toMatchObject({
      theme: 'midnight-blue',
      language: 'en-US',
      memory: { enabled: true },
      context: { compaction_threshold_ratio: 0.8 },
      providers: {
        deepseek: {
          api_key: 'TEST_DEEPSEEK_API_KEY',
          enabled: false,
          api: 'openai-completions',
          display_name: 'DeepSeek',
          base_url: 'https://api.deepseek.com',
          models: {
            'deepseek-v4-flash': { context_window_tokens: 1_000_000, max_output_tokens: 384_000 },
            'deepseek-v4-pro': { context_window_tokens: 1_000_000, max_output_tokens: 384_000 },
          },
        },
      },
    });
  });

  it('persists provider and model selection atomically', () => {
    const store = memoryStore();
    const settings = createSettings({ store });
    expect(settings.update({ patch: {
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-v4-pro' },
    } })).toMatchObject({ status: 'updated' });
    expect(store.document).toMatchObject({
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-v4-pro' },
    });
  });

  it('uses the Permission owner schema for persisted rules', () => {
    const rule = {
      source: 'session',
      source_id: 'session_1',
      target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } },
    } as const;
    expect(PermissionRuleSchema.parse(rule)).toEqual(rule);
    expect(() => PermissionRuleSchema.parse({ source: 'session', target: rule.target })).toThrow(/source_id/);
  });

  it('requires provider and model identities for Provider resolution', () => {
    expect(ResolveProviderSettingsRequestSchema.parse({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    })).toEqual({ provider_id: 'deepseek', model_id: 'deepseek-v4-flash' });
    expect(() => ResolveProviderSettingsRequestSchema.parse({ provider_id: 'deepseek' })).toThrow();
  });

  it('generates the settings.json schema from the internal file model', () => {
    const jsonSchema = createSettingsJsonSchema();
    expect(jsonSchema).toMatchObject({
      title: 'Megumi settings',
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual(SettingsRawSchema.keyof().options);
    const providerSchema = jsonSchema.properties?.providers?.additionalProperties as {
      properties?: Record<string, unknown>;
    };
    expect(providerSchema.properties).toHaveProperty('api_key');
    expect(jsonSchema.properties?.permissions).toMatchObject({
      type: 'object',
      properties: { allow: { type: 'array' } },
    });
  });
});

function memoryStore(initial: unknown = {}) {
  const store: SettingsStore & { document: unknown } = {
    document: initial,
    read: () => structuredClone(store.document),
    write(next) {
      store.document = structuredClone(next);
    },
  };
  return store;
}
