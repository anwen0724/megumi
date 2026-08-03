import { describe, expect, it } from 'vitest';
import { BUILT_IN_TOOL_NAMES, createBuiltInToolRegistry } from '../../../packages/tools/src';
import { createProcessAdapter } from './tool-test-fixtures';

describe('built-in Tool Registry', () => {
  it('binds every built-in Definition to its same-name Handler', () => {
    const registry = createBuiltInToolRegistry({ process: createProcessAdapter() });
    expect(registry.list().map((tool) => tool.registeredToolName)).toEqual(BUILT_IN_TOOL_NAMES);
    for (const tool of registry.list()) {
      expect(tool.definition.name).toBe(tool.handler.toolName);
      expect(tool.definition.description.length).toBeGreaterThan(0);
      expect(tool.definition.parameters.type).toBe('object');
      expect(tool.definition).not.toHaveProperty('capabilities');
      expect(tool.definition).not.toHaveProperty('riskLevel');
      expect(tool.definition).not.toHaveProperty('sideEffect');
      expect(tool.definition).not.toHaveProperty('availability');
      expect(tool.definition).not.toHaveProperty('executionMode');
    }
  });
});
