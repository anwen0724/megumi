import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TOOL_SOURCE,
  createBuiltInToolRegistrations,
  createToolRegistry,
} from '@megumi/coding-agent/tools/core/tool-registry';

describe('tool registry core', () => {
  it('filters disabled sources, registrations, and definitions', () => {
    const registrations = createBuiltInToolRegistrations();
    const disabledSource = {
      ...registrations[0],
      source: { ...registrations[0].source, enabled: false },
    };
    const disabledRegistration = {
      ...registrations[1],
      enabled: false,
    };
    const disabledDefinition = {
      ...registrations[2],
      definition: {
        ...registrations[2].definition,
        availability: { status: 'disabled' as const, reason: 'disabled for test' },
      },
    };

    const registry = createToolRegistry({
      registrations: [
        disabledSource,
        disabledRegistration,
        disabledDefinition,
        ...registrations.slice(3),
      ],
    });

    expect(registry.listAvailableTools().map((tool) => tool.registeredToolName)).toEqual([
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
      'activate_skill',
    ]);
  });

  it('keeps conflicts unavailable without failing the whole registry', () => {
    const registrations = createBuiltInToolRegistrations();
    const duplicate = {
      ...registrations[0],
      registrationId: 'duplicate-read-file',
      definition: { ...registrations[0].definition },
    };

    const registry = createToolRegistry({
      registrations: [registrations[0], duplicate, ...registrations.slice(1)],
    });

    expect(registry.getRegisteredTool('read_file')).toBeUndefined();
    expect(registry.listAvailableTools().map((tool) => tool.registeredToolName)).toEqual([
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
      'activate_skill',
    ]);
  });

  it('does not expose non-built-in registrations with unavailable source state', () => {
    const registrations = createBuiltInToolRegistrations();
    const externalRegistration = {
      ...registrations[0],
      registrationId: 'tool-registration-skill-read_file',
      source: {
        ...BUILT_IN_TOOL_SOURCE,
        sourceId: 'skill_alpha',
        sourceKind: 'skill' as const,
        namespace: 'alpha',
        enabled: false,
      },
    };

    const registry = createToolRegistry({ registrations: [externalRegistration] });

    expect(registry.listAvailableTools()).toEqual([]);
    expect(registry.getRegisteredTool('alpha_read_file')).toBeUndefined();
  });
});
