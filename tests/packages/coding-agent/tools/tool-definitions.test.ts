import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOL_DEFINITIONS,
  BUILT_IN_TOOL_NAMES,
  listBuiltInToolDefinitions,
} from '@megumi/coding-agent/tools/core/tool-definitions';

describe('tool definitions', () => {
  it('defines the V1 built-in tools in registry order', () => {
    expect(BUILT_IN_TOOL_NAMES).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
      'activate_skill',
      'web_search',
      'web_fetch',
    ]);
    expect(BUILT_IN_TOOL_DEFINITIONS.map((definition) => definition.name)).toEqual(BUILT_IN_TOOL_NAMES);
  });

  it('returns cloned definitions so callers cannot mutate module state', () => {
    const definitions = listBuiltInToolDefinitions();

    definitions[0].description = 'changed';

    expect(listBuiltInToolDefinitions()[0].description).not.toBe('changed');
  });

  it('keeps built-in definitions available with required execution metadata', () => {
    for (const definition of listBuiltInToolDefinitions()) {
      expect(definition.availability.status).toBe('available');
      expect(definition.capabilities.length).toBeGreaterThan(0);
      expect(definition.riskLevel).toMatch(/^(low|medium|high|critical)$/);
      expect(definition.sideEffect).toBeTruthy();
      expect(definition.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('allows run_command to carry internal skill script metadata', () => {
    const runCommand = listBuiltInToolDefinitions()
      .find((definition) => definition.name === 'run_command');

    expect(runCommand?.sideEffect).toBe('execute_command');
    expect(runCommand?.capabilities).toContain('command_run');
    expect(runCommand?.inputSchema).toMatchObject({
      properties: {
        metadata: {
          type: 'object',
          additionalProperties: true,
        },
      },
    });
  });

  it('classifies web_search as a read-only open-world network tool', () => {
    const webSearch = listBuiltInToolDefinitions()
      .find((definition) => definition.name === 'web_search');

    expect(webSearch).toMatchObject({
      capabilities: ['network_access'],
      riskLevel: 'medium',
      sideEffect: 'access_network',
      executionMode: 'parallel',
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    });
  });

  it('classifies web_fetch as a read-only open-world network tool', () => {
    const webFetch = listBuiltInToolDefinitions().find((definition) => definition.name === 'web_fetch');
    expect(webFetch).toMatchObject({
      capabilities: ['network_access'],
      riskLevel: 'medium',
      sideEffect: 'access_network',
      executionMode: 'parallel',
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    });
  });
});
