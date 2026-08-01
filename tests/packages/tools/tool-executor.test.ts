/* Protects Tool lookup and schema validation before any execution side effect. */

import { describe, expect, it, vi } from 'vitest';
import {
  createToolCatalog,
  createToolExecutor,
  type ToolDefinition,
  type ToolRegistration,
} from '../../../packages/tools/src';

const definition: ToolDefinition = {
  name: 'collect_paths',
  description: 'Collect non-empty paths.',
  inputSchema: {
    type: 'object',
    properties: {
      paths: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
    required: ['paths'],
    additionalProperties: false,
  },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

describe('ToolExecutor', () => {
  it('returns unknown_tool without invoking the Adapter', async () => {
    const adapter = { execute: vi.fn() };
    const executor = createToolExecutor({
      catalog: createToolCatalog({ registrations: [registration()] }),
      adapter,
    });

    await expect(executor.execute({ toolName: 'missing_tool', input: {} })).resolves.toMatchObject({
      type: 'failed',
      error: { code: 'unknown_tool' },
      normalizedResult: { kind: 'error', isError: true },
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('rejects missing required input before invoking the Adapter', async () => {
    const adapter = { execute: vi.fn() };
    const executor = createToolExecutor({
      catalog: createToolCatalog({ registrations: [registration()] }),
      adapter,
    });

    const result = await executor.execute({ toolName: 'collect_paths', input: {} });
    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'invalid_tool_input',
        message: 'Invalid tool input at $.paths: missing required property.',
      },
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('validates every array item before invoking the Adapter', async () => {
    const adapter = { execute: vi.fn() };
    const executor = createToolExecutor({
      catalog: createToolCatalog({ registrations: [registration()] }),
      adapter,
    });

    const result = await executor.execute({
      toolName: 'collect_paths',
      input: { paths: ['README.md', 42] },
    });
    expect(result).toMatchObject({
      type: 'failed',
      error: {
        code: 'invalid_tool_input',
        message: 'Invalid tool input at $.paths[1]: expected string.',
      },
    });
    expect(adapter.execute).not.toHaveBeenCalled();
  });
});

function registration(): ToolRegistration {
  return {
    registrationId: 'registration:collect_paths',
    source: {
      sourceId: 'built_in',
      sourceKind: 'built_in',
      namespace: 'megumi',
      displayName: 'Built-in tools',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    definition,
    enabled: true,
    availability: { status: 'available' },
  };
}
