// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSettingsJsonSchema,
  DEFAULT_SETTINGS,
  mergeRawSettings,
  PermissionRuleSchema,
  ResolveProviderRuntimeConfigRequestSchema,
  resolveSettings,
  SettingsRawSchema,
} from '@megumi/coding-agent/settings';

describe('Settings v2 contracts', () => {
  it('accepts sparse raw settings and resolves defaults', () => {
    expect(SettingsRawSchema.parse({})).toEqual({});
    expect(resolveSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('merges sparse raw settings without expanding defaults', () => {
    expect(mergeRawSettings({
      theme: 'midnight-blue',
      providers: {
        deepseek: {
          api_key: 'sk-deepseek',
        },
      },
    }, {
      language: 'en-US',
      memory: {
        enabled: true,
      },
      providers: {
        deepseek: {
          enabled: false,
        },
      },
    })).toEqual({
      theme: 'midnight-blue',
      language: 'en-US',
      memory: {
        enabled: true,
      },
      providers: {
        deepseek: {
          api_key: 'sk-deepseek',
          enabled: false,
        },
      },
    });
  });

  it('validates permission rules as Settings-owned contracts', () => {
    expect(PermissionRuleSchema.parse({
      source: 'session',
      source_id: 'session_1',
      pattern: 'tool:run_command|command=npm test',
    })).toEqual({
      source: 'session',
      source_id: 'session_1',
      pattern: 'tool:run_command|command=npm test',
    });

    expect(() => PermissionRuleSchema.parse({
      source: 'session',
      pattern: 'tool:run_command|command=npm test',
    })).toThrow(/source_id/);
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
