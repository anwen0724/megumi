import { describe, expect, it, vi } from 'vitest';
import {
  createCommandService,
  type CommandDefinition,
} from '@megumi/agent/commands';

describe('createCommandService', () => {
  it('lists registered command display items', () => {
    const service = createCommandService({
      built_in_commands: [testCommand('review')],
    });

    expect(service.listCommands()).toEqual([{
      name: 'review',
      description: 'review command',
      source: { kind: 'built_in' },
    }, {
      name: 'skill',
      description: 'Use a skill by its name',
      argument_hint: '<name> [task]',
      source: { kind: 'built_in' },
    }]);
  });

  it('returns suggestions without executing commands', async () => {
    let executed = false;
    const service = createCommandService({
      built_in_commands: [{
        ...testCommand('review'),
        async execute() {
          executed = true;
          return { type: 'completed' };
        },
      }],
    });

    await expect(service.getCommandSuggestions({ draft_input: '/re' })).resolves.toMatchObject({
      type: 'suggestions',
      command_prefix: 're',
      groups: [{
        id: 'commands',
        items: [{
          name: 'review',
          completion: { replacement_input: '/review ' },
        }],
      }, {
        id: 'skills',
        items: [],
      }],
    });
    expect(executed).toBe(false);
  });

  it('builds skill suggestions from a workspace-aware skill command provider', async () => {
    const listSkillCommands = vi.fn(async () => [
      {
        name: 'brainstorming',
        skillPath: 'C:/system/brainstorming/SKILL.md',
        description: 'Explore intent before implementation',
        sourceLabel: 'System' as const,
      },
    ]);
    const service = createCommandService({
      built_in_commands: [testCommand('review')],
      skillCommandProvider: { listSkillCommands },
    });

    const result = await service.getCommandSuggestions({
      draft_input: '/bra',
      workspaceId: 'workspace:1',
    });

    expect(listSkillCommands).toHaveBeenCalledWith({ workspaceId: 'workspace:1' });
    expect(result).toMatchObject({
      type: 'suggestions',
      groups: [{
        id: 'commands',
      }, {
        id: 'skills',
        items: [{
          name: 'brainstorming',
          source: { kind: 'skill', name: 'brainstorming', skillPath: 'C:/system/brainstorming/SKILL.md' },
          display: {
            primary: 'brainstorming',
            secondary: 'Explore intent before implementation',
            badge: 'System',
          },
          completion: {
            replacement_input: '',
            selection: { type: 'skill', name: 'brainstorming', skillPath: 'C:/system/brainstorming/SKILL.md' },
          },
        }],
      }],
    });
    expect(JSON.stringify(result)).not.toContain('workspace:1');
  });

  it('handles ordinary input, invalid slash input, and unknown commands as not command', async () => {
    const service = createCommandService({
      built_in_commands: [testCommand('review')],
    });

    await expect(service.handleCommandInput({ raw_input: 'hello' })).resolves.toEqual({
      type: 'not_command',
      raw_input: 'hello',
    });
    await expect(service.handleCommandInput({ raw_input: '/' })).resolves.toEqual({
      type: 'not_command',
      raw_input: '/',
    });
    await expect(service.handleCommandInput({ raw_input: '/unknown abc' })).resolves.toEqual({
      type: 'not_command',
      raw_input: '/unknown abc',
    });
  });

  it('executes registered commands by parsed input or invocation', async () => {
    const service = createCommandService({
      built_in_commands: [testCommand('review')],
    });

    await expect(service.handleCommandInput({ raw_input: '/review current diff' })).resolves.toEqual({
      type: 'completed',
      message: '/review current diff',
    });
    await expect(service.executeCommand({
      invocation: {
        name: 'review',
        arguments_input: 'current diff',
        raw_input: '/review current diff',
      },
    })).resolves.toEqual({
      type: 'completed',
      message: '/review current diff',
    });
  });

  it('checks catalog resolution even when executeCommand receives an invocation', async () => {
    const service = createCommandService({
      built_in_commands: [testCommand('review')],
    });

    await expect(service.executeCommand({
      invocation: {
        name: 'missing',
        arguments_input: '',
        raw_input: '/missing',
      },
    })).resolves.toEqual({
      type: 'not_command',
      raw_input: '/missing',
    });
  });

  it('passes execution context to command handlers', async () => {
    const seen: unknown[] = [];
    const service = createCommandService({
      built_in_commands: [{
        ...testCommand('compact'),
        async execute(request) {
          seen.push(request.execution_context);
          return { type: 'completed' };
        },
      }],
    });

    await service.handleCommandInput({
      raw_input: '/compact',
      execution_context: {
        session_id: 'session:1',
        services: {},
      },
    });

    expect(seen).toEqual([{
      session_id: 'session:1',
      services: {},
    }]);
  });
});

function testCommand(name: string): CommandDefinition {
  return {
    name,
    description: `${name} command`,
    source: { kind: 'built_in' },
    async execute({ invocation }) {
      return {
        type: 'completed',
        message: invocation.raw_input,
      };
    },
  };
}
