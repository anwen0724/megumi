import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOL_DEFINITIONS,
  BUILT_IN_TOOL_NAMES,
  createBuiltInToolRegistry,
} from '@megumi/tools/built-ins';

describe('built-in tool definitions', () => {
  it('exposes the first v1 built-in tool set with Claude-compatible names', () => {
    expect(BUILT_IN_TOOL_NAMES).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
    expect(BUILT_IN_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(BUILT_IN_TOOL_NAMES);
    for (const definition of BUILT_IN_TOOL_DEFINITIONS) {
      expect(definition.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(definition.availability.status).toBe('available');
      expect(definition.inputSchema.type).toBe('object');
    }
  });

  it('uses Project terminology and conservative side effects', () => {
    const byName = Object.fromEntries(BUILT_IN_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

    expect(byName.read_file.capabilities).toEqual(['project_read']);
    expect(byName.list_directory.capabilities).toEqual(['project_read']);
    expect(byName.glob.capabilities).toEqual(['project_read']);
    expect(byName.search_text.capabilities).toEqual(['project_read']);
    expect(byName.edit_file.capabilities).toEqual(['project_write']);
    expect(byName.write_file.capabilities).toEqual(['project_write']);
    expect(byName.run_command.capabilities).toEqual(['command_run']);

    expect(byName.read_file.sideEffect).toBe('none');
    expect(byName.search_text.sideEffect).toBe('none');
    expect(byName.edit_file.sideEffect).toBe('project_file_operation');
    expect(byName.write_file.sideEffect).toBe('project_file_operation');
    expect(byName.run_command.sideEffect).toBe('execute_command');
  });

  it('creates a registry that lists all built-ins for tool-capable providers', () => {
    const registry = createBuiltInToolRegistry();

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolUse: true },
    }).map((tool) => tool.name)).toEqual(BUILT_IN_TOOL_NAMES);

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolUse: false },
    })).toEqual([]);
  });
});
