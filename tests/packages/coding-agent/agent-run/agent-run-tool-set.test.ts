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
    });
    const second = builder.getToolSet({
      run_id: 'run-1',
    });

    expect(listAvailableTools).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first).toEqual([
      {
        name: 'read_file',
        description: 'Read files for the model',
        inputSchema: { type: 'object' },
      },
    ]);
    expect(builder.getRegisteredTool('run-1', 'read_file')?.definition.executionMode).toBe('parallel');
  });

  it('does not filter the run Tool Set by provider capability flags', () => {
    const listAvailableTools = vi.fn(() => ({ tools: [registeredTool()] }));
    const builder = createRunToolSetBuilder({
      tool_registry_service: { listAvailableTools },
    });

    const toolSet = builder.getToolSet({
      run_id: 'run-1',
    });

    expect(toolSet.map((item) => item.name)).toEqual(['read_file']);
    expect(listAvailableTools).toHaveBeenCalledTimes(1);
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
