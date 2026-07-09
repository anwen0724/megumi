import { describe, expect, it } from 'vitest';
import {
  createCommandService,
  type CommandDefinition,
} from '@megumi/coding-agent/commands';

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
      description: 'Use a skill by skillId',
      argument_hint: '<skillId> [args]',
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

    expect(service.getCommandSuggestions({ draft_input: '/re' })).toMatchObject({
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
