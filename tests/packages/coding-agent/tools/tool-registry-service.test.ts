import { describe, expect, it } from 'vitest';
import { ToolRegistryService } from '@megumi/coding-agent/tools';

describe('ToolRegistryService', () => {
  it('lists only available registered built-in tools', () => {
    const service = new ToolRegistryService();

    const result = service.listAvailableTools();

    expect(result.tools.map((tool) => tool.registeredToolName)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
      'activate_skill',
    ]);
    for (const tool of result.tools) {
      expect(tool.status).toBe('available');
      expect(tool.identity.sourceId).toBe('built_in');
      expect(tool.identity.namespace).toBe('megumi');
      expect(tool.registeredToolName).toBe(tool.definition.name);
    }
  });

  it('finds available tools by registered tool name', () => {
    const service = new ToolRegistryService();

    expect(service.getRegisteredTool({ toolName: 'read_file' })).toMatchObject({
      type: 'found',
      tool: {
        registeredToolName: 'read_file',
        status: 'available',
      },
    });
  });

  it('returns not_found for disabled, conflicted, or unknown tool names', () => {
    const service = new ToolRegistryService();

    expect(service.getRegisteredTool({ toolName: 'missing_tool' })).toEqual({
      type: 'not_found',
      toolName: 'missing_tool',
    });
  });
});
