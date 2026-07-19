// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettingsService,
  createSettingsJsonSchema,
  DEFAULT_SETTINGS,
  PermissionRuleSchema,
  ResolveProviderRuntimeConfigRequestSchema,
  SettingsRawSchema,
  type SettingsRaw,
} from '@megumi/agent/settings';

describe('Settings v2 contracts', () => {
  it('accepts sparse raw settings and resolves defaults', () => {
    expect(SettingsRawSchema.parse({})).toEqual({});
    expect(createSettingsService({
      file_store: memorySettingsFileStore(),
    }).getResolvedSettings()).toEqual({ status: 'ok', settings: DEFAULT_SETTINGS });
  });

  it('merges sparse patches and materializes saved provider defaults', () => {
    const fileStore = memorySettingsFileStore({
      theme: 'midnight-blue',
      providers: {
        deepseek: {
          api_key: 'TEST_DEEPSEEK_API_KEY',
        },
      },
    });
    const service = createSettingsService({ file_store: fileStore });

    service.updateSettings({
      patch: {
        language: 'en-US',
        memory: {
          enabled: true,
        },
        providers: {
          deepseek: {
            enabled: false,
          },
        },
      },
    });

    expect(fileStore.readRawSettings()).toEqual({
      theme: 'midnight-blue',
      language: 'en-US',
      memory: {
        enabled: true,
      },
      context: {
        compaction_threshold_ratio: 0.8,
      },
      providers: {
        deepseek: {
          api_key: 'TEST_DEEPSEEK_API_KEY',
          enabled: false,
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
        },
      },
    });
  });

  it('validates permission rules as Settings-owned contracts', () => {
    const rule = {
      source: 'session',
      source_id: 'session_1',
      target: { kind: 'tool', tool_identity: { source_id: 'built_in', namespace: 'megumi', source_tool_name: 'run_command' } },
    } as const;
    expect(PermissionRuleSchema.parse(rule)).toEqual(rule);

    expect(() => PermissionRuleSchema.parse({
      source: 'session',
      target: rule.target,
    })).toThrow(/source_id/);
    expect(PermissionRuleSchema.safeParse({ source: 'user', pattern: 'tool:run_command' }).success).toBe(false);
  });

  it('requires provider and model ids for runtime config resolution requests', () => {
    expect(ResolveProviderRuntimeConfigRequestSchema.parse({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    })).toEqual({
      provider_id: 'deepseek',
      model_id: 'deepseek-v4-flash',
    });

    expect(() => ResolveProviderRuntimeConfigRequestSchema.parse({
      provider_id: 'deepseek',
    })).toThrow();
  });

  it('generates editor JSON Schema from Settings-owned raw settings contracts', () => {
    const jsonSchema = createSettingsJsonSchema();

    expect(jsonSchema).toMatchObject({
      title: 'Megumi settings',
      type: 'object',
      additionalProperties: false,
    });
    expect(Object.keys(jsonSchema.properties ?? {})).toEqual(SettingsRawSchema.keyof().options);
    expect(jsonSchema.properties?.permissions).toMatchObject({
      type: 'object',
      properties: {
        allow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source_id: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    });
  });
});

function memorySettingsFileStore(initial: SettingsRaw = {}) {
  let raw = initial;
  return {
    readRawSettings: () => raw,
    writeRawSettings(next: SettingsRaw) {
      raw = next;
    },
  };
}
