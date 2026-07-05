import { describe, expect, it, vi } from 'vitest';
import type { RegisteredTool } from '@megumi/coding-agent/tools';
import { createRunToolSetBuilder } from '@megumi/coding-agent/agent-run/core/tool-set-builder';

describe('run-level Tool Set builder', () => {
  it('builds Tool Set once per run from available registered tools', () => {
    const listAvailableTools = vi.fn(() => ({ tools: [registeredTool()] }));
    const builder = createRunToolSetBuilder({
      tool_registry_service: { listAvailableTools },
    });

    const first = builder.getToolSet({
      run_id: 'run-1',
      provider_capabilities: { supports_tool_call: true },
    });
    const second = builder.getToolSet({
      run_id: 'run-1',
      provider_capabilities: { supports_tool_call: true },
    });

    expect(listAvailableTools).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first.items).toEqual([
      {
        name: 'read_file',
        description: 'Read files for the model',
        input_schema: { type: 'object' },
        source_tool_name: 'read_file',
      },
    ]);
    expect(builder.getRegisteredTool('run-1', 'read_file')?.definition.executionMode).toBe('parallel');
  });

  it('returns an empty Tool Set without touching registry when provider does not support tools', () => {
    const listAvailableTools = vi.fn(() => ({ tools: [registeredTool()] }));
    const builder = createRunToolSetBuilder({
      tool_registry_service: { listAvailableTools },
    });

    const toolSet = builder.getToolSet({
      run_id: 'run-1',
      provider_capabilities: { supports_tool_call: false },
    });

    expect(toolSet.items).toEqual([]);
    expect(listAvailableTools).not.toHaveBeenCalled();
  });
});

function registeredTool(): RegisteredTool {
  return {
    identity: {
      sourceId: 'built-in',
      namespace: 'built-in',
      sourceToolName: 'read_file',
    },
    registeredToolName: 'read_file',
    status: 'available',
    source: {
      sourceId: 'built-in',
      sourceKind: 'built_in',
      namespace: 'built-in',
      displayName: 'Built in',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    definition: {
      name: 'read_file',
      description: 'Read files',
      modelFacingDescription: 'Read files for the model',
      inputSchema: { type: 'object' },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      availability: { status: 'available' },
      executionMode: 'parallel',
    },
  };
}
