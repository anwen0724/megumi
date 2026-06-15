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

  it('includes registry-facing execution and permission metadata on every built-in definition', () => {
    const byName = Object.fromEntries(BUILT_IN_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

    expect(byName.read_file.executionMode).toBe('parallel');
    expect(byName.list_directory.executionMode).toBe('parallel');
    expect(byName.glob.executionMode).toBe('parallel');
    expect(byName.search_text.executionMode).toBe('parallel');
    expect(byName.edit_file.executionMode).toBe('serial');
    expect(byName.write_file.executionMode).toBe('serial');
    expect(byName.run_command.executionMode).toBe('serial');

    for (const definition of BUILT_IN_TOOL_DEFINITIONS) {
      expect(definition.outputSchema).toBeDefined();
      expect(definition.executionMode).toBeDefined();
      expect(definition.permissionMetadata).toEqual({ ruleToolName: definition.name });
      expect(definition.modelFacingDescription).toEqual(expect.any(String));
      expect(definition.modelFacingDescription?.length).toBeGreaterThan(0);
    }
  });

  it('creates a registry that lists all built-ins for tool-capable providers', () => {
    const registry = createBuiltInToolRegistry();

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: true },
    }).map((tool) => tool.name)).toEqual(BUILT_IN_TOOL_NAMES);

    expect(registry.listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: false },
    })).toEqual([]);
  });

  it('exports deeply frozen built-in definitions', () => {
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS[0])).toBe(true);
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS[0].capabilities)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS[0].availability)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS[0].inputSchema)).toBe(true);
    expect(Object.isFrozen(BUILT_IN_TOOL_DEFINITIONS[0].inputSchema.properties)).toBe(true);
  });

  it('keeps exported built-in mutations from affecting registry availability or order', () => {
    try {
      BUILT_IN_TOOL_DEFINITIONS[0].availability.status = 'disabled';
      BUILT_IN_TOOL_DEFINITIONS[0].capabilities.push('command_run');
    } catch {
      // Frozen exports may throw; the assertion below verifies the public behavior.
    }

    expect(createBuiltInToolRegistry().listDefinitions({
      runId: 'run-1',
      projectId: 'project-1',
      permissionMode: 'default',
      providerCapabilitySummary: { supportsToolCall: true },
    }).map((tool) => tool.name)).toEqual(BUILT_IN_TOOL_NAMES);
    expect(createBuiltInToolRegistry().getDefinition('read_file')?.capabilities).toEqual(['project_read']);
  });
});
