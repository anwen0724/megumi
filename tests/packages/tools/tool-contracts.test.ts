import { describe, expect, it } from 'vitest';
import { createToolRegistry, type ToolDefinition, type ToolRegistration } from '../../../packages/tools/src';
import * as PublicTools from '../../../packages/tools/src';

const definition: ToolDefinition = {
  name: 'echo', description: 'Echo one string.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
};

function registration(name = 'echo'): ToolRegistration {
  const current = { ...definition, name };
  return {
    registrationId: `registration:${name}`,
    source: { sourceId: 'built_in', sourceKind: 'built_in', namespace: 'megumi', displayName: 'Built in', configured: true, enabled: true, availabilityStatus: 'available' },
    definition: current,
    handler: { toolName: name, operations: () => [], async execute() { return { outputKind: 'text', content: name }; } },
    availability: { status: 'available' },
  };
}

describe('Tool public contracts', () => {
  it('exports Registry and Router but not legacy Catalog or Executor seams', () => {
    expect(PublicTools.createToolRegistry).toBeTypeOf('function');
    expect(PublicTools.createToolRouter).toBeTypeOf('function');
    expect(PublicTools).not.toHaveProperty('createToolCatalog');
    expect(PublicTools).not.toHaveProperty('createToolExecutor');
    expect(PublicTools).not.toHaveProperty('validateToolInput');
  });

  it('keeps ToolDefinition limited to model-visible fields', () => {
    expect(Object.keys(definition)).toEqual(['name', 'description', 'inputSchema']);
  });

  it('rejects duplicate names and Definition/Handler mismatches', () => {
    expect(() => createToolRegistry({ registrations: [registration(), registration()] })).toThrow('Duplicate registered Tool name');
    expect(() => createToolRegistry({ registrations: [{
      ...registration(), handler: { ...registration().handler, toolName: 'other' },
    }] })).toThrow('Definition and Handler names differ');
  });
});
