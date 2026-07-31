/* Verifies the stable Tool Catalog, Executor, normalization, and public exports. */

import { describe, expect, it } from 'vitest';
import {
  createToolCatalog,
  createToolExecutor,
  type ToolDefinition,
  type ToolRegistration,
} from '../../../packages/tools/src';
import * as PublicTools from '../../../packages/tools/src';

const definition: ToolDefinition = {
  name: 'echo',
  description: 'Echo one string.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', minLength: 1 } },
    required: ['text'],
    additionalProperties: false,
  },
  capabilities: ['system_integration'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'parallel',
};

describe('Tool public contracts', () => {
  it('exports the stable Executor creation seam without internal validation algorithms', () => {
    expect(createToolExecutor).toBeTypeOf('function');
    expect(PublicTools).not.toHaveProperty('validateToolInput');
    expect(PublicTools).not.toHaveProperty('MAX_NORMALIZED_CONTENT_BYTES');
  });

  it('returns immutable snapshots instead of registration-owned objects', () => {
    const registration = createRegistration(definition);
    const catalog = createToolCatalog({ registrations: [registration] });
    const first = catalog.get({ toolName: 'echo' });
    expect(first.status).toBe('found');
    if (first.status === 'found') {
      (first.tool.definition.inputSchema as { type: string }).type = 'string';
    }
    expect(catalog.get({ toolName: 'echo' })).toMatchObject({
      status: 'found',
      tool: { definition: { inputSchema: { type: 'object' } } },
    });
  });

  it('keeps conflicting registrations unavailable without hiding other Tools', () => {
    const catalog = createToolCatalog({
      registrations: [
        createRegistration(definition),
        { ...createRegistration(definition), registrationId: 'duplicate' },
        createRegistration({ ...definition, name: 'other' }),
      ],
    });
    expect(catalog.get({ toolName: 'echo' }).status).toBe('not_found');
    expect(catalog.list().tools.map((tool) => tool.registeredToolName)).toEqual(['other']);
  });

  it('validates Tool names, input schemas, and capabilities at registration', () => {
    expect(() => createToolCatalog({
      registrations: [createRegistration({ ...definition, name: 'Invalid Name' })],
    })).toThrow('Invalid Tool name');
    expect(() => createToolCatalog({
      registrations: [createRegistration({ ...definition, inputSchema: { type: 'string' } })],
    })).toThrow('inputSchema must describe an object');
    expect(() => createToolCatalog({
      registrations: [createRegistration({ ...definition, capabilities: [] })],
    })).toThrow('requires at least one capability');
  });

  it('filters disabled source, registration, and definition states', () => {
    const enabled = createRegistration(definition);
    const catalog = createToolCatalog({
      registrations: [
        { ...enabled, registrationId: 'source-disabled', source: { ...enabled.source, enabled: false } },
        { ...enabled, registrationId: 'registration-disabled', definition: { ...definition, name: 'second' }, enabled: false },
        {
          ...enabled,
          registrationId: 'definition-disabled',
          definition: {
            ...definition,
            name: 'third',
            availability: { status: 'disabled', reason: 'disabled for test' },
          },
        },
        createRegistration({ ...definition, name: 'available' }),
      ],
    });
    expect(catalog.list().tools.map((tool) => tool.registeredToolName)).toEqual(['available']);
    expect(catalog.get({ toolName: 'echo' }).status).toBe('not_found');
    expect(catalog.get({ toolName: 'second' }).status).toBe('not_found');
    expect(catalog.get({ toolName: 'third' }).status).toBe('not_found');
  });

  it('names non-built-in Tools with their namespace and hides unavailable sources', () => {
    const external = createRegistration(definition);
    const available = {
      ...external,
      registrationId: 'external-available',
      source: {
        ...external.source,
        sourceId: 'skill_alpha',
        sourceKind: 'skill' as const,
        namespace: 'alpha',
      },
    };
    const unavailable = {
      ...available,
      registrationId: 'external-unavailable',
      definition: { ...definition, name: 'hidden' },
      source: { ...available.source, availabilityStatus: 'unavailable' as const },
    };
    const catalog = createToolCatalog({ registrations: [available, unavailable] });
    expect(catalog.list().tools.map((tool) => tool.registeredToolName)).toEqual(['alpha_echo']);
    expect(catalog.get({ toolName: 'alpha_echo' })).toMatchObject({
      status: 'found',
      tool: {
        identity: { sourceId: 'skill_alpha', namespace: 'alpha', sourceToolName: 'echo' },
      },
    });
    expect(catalog.get({ toolName: 'alpha_hidden' })).toEqual({
      status: 'not_found', toolName: 'alpha_hidden',
    });
  });

});

function createRegistration(toolDefinition: ToolDefinition): ToolRegistration {
  return {
    registrationId: `registration:${toolDefinition.name}`,
    source: {
      sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi',
      displayName: 'Built-in tools', configured: true, enabled: true,
      availabilityStatus: 'available',
    },
    definition: toolDefinition,
    enabled: true,
    availability: { status: 'available' },
  };
}
