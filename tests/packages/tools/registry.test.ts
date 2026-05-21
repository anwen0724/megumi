import { describe, expect, it } from 'vitest';
import { createStaticToolRegistry } from '@megumi/tools/registry';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';

const readTool: ToolDefinition = {
  name: 'read_file',
  description: 'Read a normal project file.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
    required: ['path'],
  },
  annotations: { readOnlyHint: true },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
};

const disabledTool: ToolDefinition = {
  name: 'run_command',
  description: 'Run a project-scoped command.',
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
      projectId: 'project-1',
      permissionMode: 'default',
    })).toEqual([readTool]);
  });

  it('hides tools when the provider cannot use tools', () => {
    const registry = createStaticToolRegistry([readTool]);

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolUse: false },
    })).toEqual([]);
    expect(registry.getDefinition('read_file', {
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolUse: false },
    })).toBeUndefined();
  });

  it('supports destructured getDefinition with visibility input', () => {
    const { getDefinition } = createStaticToolRegistry([readTool]);

    expect(getDefinition('read_file', {
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    })?.name).toBe('read_file');
  });

  it('finds definitions by Claude-compatible tool name', () => {
    const registry = createStaticToolRegistry([readTool]);

    expect(registry.getDefinition('read_file')?.description).toContain('Read');
    expect(registry.getDefinition('workspace.file.read')).toBeUndefined();
  });

  it('prevents caller mutation from changing registry availability or order', () => {
    const registry = createStaticToolRegistry([readTool, {
      ...readTool,
      name: 'list_directory',
      description: 'List a project directory.',
    }]);
    const firstList = registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    });

    firstList[0].availability.status = 'disabled';
    firstList[1].capabilities.push('command_run');

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
    }).map((definition) => definition.name)).toEqual(['read_file', 'list_directory']);
    expect(registry.getDefinition('read_file')?.availability.status).toBe('available');
    expect(registry.getDefinition('list_directory')?.capabilities).toEqual(['project_read']);
  });

  it('rejects duplicate tool names', () => {
    expect(() => createStaticToolRegistry([readTool, readTool])).toThrow(/Duplicate tool name/);
  });
});
