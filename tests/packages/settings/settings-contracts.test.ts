/* Verifies the generated settings editor schema. */
import { describe, expect, it } from 'vitest';
import { createSettingsJsonSchema } from '@megumi/application/settings';
describe('Settings editor schema', () => {
  it('generates the settings.json schema from the internal file model', () => {
    const jsonSchema = createSettingsJsonSchema();
    expect(jsonSchema).toMatchObject({
      title: 'Megumi settings',
      type: 'object',
      // The file model tolerates unknown keys, so editors allow them too.
      additionalProperties: true,
    });

    const providerSchema = jsonSchema.properties?.providers?.additionalProperties as {
      properties?: Record<string, unknown>;
    };
    expect(providerSchema?.properties).toHaveProperty('apiKeyEnv');
    expect(providerSchema?.properties).not.toHaveProperty('api_key');
    expect(jsonSchema.properties?.permissions).toMatchObject({
      type: 'object',
      properties: { allow: { type: 'array' } },
    });
  });
});
