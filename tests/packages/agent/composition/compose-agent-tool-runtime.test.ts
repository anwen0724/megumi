/* Verifies host tool availability applies to the registry used by Agent runs. */
import { describe, expect, it } from 'vitest';
import { composeAgentToolRegistryService } from '../../../../packages/agent/composition/compose-agent-tool-runtime';

describe('composeAgentToolRegistryService', () => {
  it('combines host availability with dynamic web-search availability', () => {
    const registry = composeAgentToolRegistryService({
      isWebSearchEnabled: () => true,
      isBuiltInToolAvailable: (toolName) => toolName === 'read_file' || toolName === 'web_search',
    });

    const names = registry.listAvailableTools().tools.map((tool) => tool.registeredToolName);
    expect(names).toContain('read_file');
    expect(names).toContain('web_search');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_command');
  });

  it('keeps web search disabled when its runtime configuration is unavailable', () => {
    const registry = composeAgentToolRegistryService({
      isWebSearchEnabled: () => false,
      isBuiltInToolAvailable: () => true,
    });
    expect(registry.getRegisteredTool({ toolName: 'web_search' }).type).toBe('not_found');
  });
});
