import { describe, expect, it } from 'vitest';
import { ToolRegistryService } from '@megumi/agent/tools';

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
      'use_skill',
      'web_fetch',
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

  it('does not expose web_search when its runtime service is not configured', () => {
    const service = new ToolRegistryService();

    expect(service.getRegisteredTool({ toolName: 'web_search' })).toEqual({
      type: 'not_found',
      toolName: 'web_search',
    });
    expect(service.listAvailableTools().tools.some((tool) => (
      tool.registeredToolName === 'web_search'
    ))).toBe(false);
  });

  it('exposes web_search when its runtime service is configured', () => {
    const service = new ToolRegistryService({ disabledBuiltInTools: [] });

    expect(service.getRegisteredTool({ toolName: 'web_search' })).toMatchObject({
      type: 'found',
      tool: { registeredToolName: 'web_search' },
    });
  });

  it('reevaluates dynamic web_search availability for each tool set', () => {
    let enabled = false;
    const service = new ToolRegistryService({
      isBuiltInToolAvailable: (toolName) => toolName !== 'web_search' || enabled,
    });
    expect(service.getRegisteredTool({ toolName: 'web_search' }).type).toBe('not_found');
    enabled = true;
    expect(service.getRegisteredTool({ toolName: 'web_search' }).type).toBe('found');
  });
});
