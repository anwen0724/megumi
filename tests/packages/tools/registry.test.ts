import { describe, expect, it } from 'vitest';
import { createStaticToolRegistry } from '@megumi/tools/registry';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';

const readTool: ToolDefinition = {
  name: 'workspace_read_file',
  description: 'Read a normal workspace file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  annotations: { readOnlyHint: true },
  capabilities: ['workspace_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const disabledTool: ToolDefinition = {
  name: 'shell_run_command',
  description: 'Run a shell command.',
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
  annotations: { destructiveHint: true },
  capabilities: ['command_run'],
  riskLevel: 'high',
  sideEffect: 'execute_command',
  availability: { status: 'disabled', reason: 'Command tools disabled.' },
};

describe('createStaticToolRegistry', () => {
  it('lists only available tools for provider-facing use', () => {
    const registry = createStaticToolRegistry([readTool, disabledTool]);

    expect(registry.listDefinitions({
      runId: 'run-1',
      runMode: 'chat',
      permissionMode: 'default',
    })).toEqual([readTool]);
  });

  it('finds definitions by Claude-compatible tool name', () => {
    const registry = createStaticToolRegistry([readTool]);

    expect(registry.getDefinition('workspace_read_file')?.description).toContain('Read');
    expect(registry.getDefinition('workspace.file.read')).toBeUndefined();
  });

  it('rejects duplicate tool names', () => {
    expect(() => createStaticToolRegistry([readTool, readTool])).toThrow(/Duplicate tool name/);
  });
});
