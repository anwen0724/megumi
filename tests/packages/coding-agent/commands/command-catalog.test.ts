import { describe, expect, it } from 'vitest';
import { createCommandCatalog } from '@megumi/coding-agent/commands/core/command-catalog';
import {
  type CommandDefinition,
} from '@megumi/coding-agent/commands';

describe('createCommandCatalog', () => {
  it('lists and resolves registered commands by name', () => {
    const catalog = createCommandCatalog({
      built_in_commands: [
        testCommand('review'),
        testCommand('status'),
      ],
    });

    expect(catalog.listCommands().map((command) => command.name)).toEqual(['review', 'status', 'skill']);
    expect(catalog.resolve('review')?.name).toBe('review');
    expect(catalog.resolve('missing')).toBeUndefined();
  });

  it('rejects duplicate command names without removing successful commands', () => {
    const catalog = createCommandCatalog({
      built_in_commands: [
        testCommand('review'),
        testCommand('review'),
        testCommand('status'),
      ],
    });

    expect(catalog.listCommands().map((command) => command.name)).toEqual(['review', 'status', 'skill']);
  });

  it('rejects alias conflicts without overwriting existing commands', () => {
    const catalog = createCommandCatalog({
      built_in_commands: [
        testCommand('settings', ['cfg']),
        testCommand('cfg'),
        testCommand('status', ['settings']),
        testCommand('broken', ['dup', 'dup']),
      ],
    });

    expect(catalog.listCommands().map((command) => command.name)).toEqual(['settings', 'skill']);
    expect(catalog.resolve('cfg')?.name).toBe('settings');
    expect(catalog.resolve('status')).toBeUndefined();
    expect(catalog.resolve('broken')).toBeUndefined();
  });

  it('builds suggestions from registered command names and aliases', () => {
    const catalog = createCommandCatalog({
      built_in_commands: [
        testCommand('review'),
        testCommand('settings', ['cfg']),
      ],
      skill_commands: createSkillSuggestionCommands(),
    });

    expect(catalog.getCommandSuggestions({ draft_input: '/' })).toMatchObject({
      type: 'suggestions',
      draft_input: '/',
      command_prefix: '',
      groups: [
        { id: 'commands', label: 'Commands' },
        { id: 'skills', label: 'Skills' },
      ],
    });
    expect(catalog.getCommandSuggestions({ draft_input: '/re' })).toMatchObject({
      type: 'suggestions',
      command_prefix: 're',
      groups: [{
        id: 'commands',
        items: [{
          name: 'review',
          match: { field: 'name', value: 'review', prefix: 're' },
          completion: { replacement_input: '/review ' },
        }],
      }, {
        id: 'skills',
        items: [],
      }],
    });
    expect(catalog.getCommandSuggestions({ draft_input: '/cfg' })).toMatchObject({
      type: 'suggestions',
      command_prefix: 'cfg',
      groups: [{
        id: 'commands',
        items: [{
          name: 'settings',
          match: { field: 'alias', value: 'cfg', prefix: 'cfg' },
          completion: { replacement_input: '/settings ' },
        }],
      }, {
        id: 'skills',
        items: [],
      }],
    });
    expect(catalog.getCommandSuggestions({ draft_input: '/br' })).toMatchObject({
      type: 'suggestions',
      command_prefix: 'br',
      groups: [{
        id: 'commands',
        items: [],
      }, {
        id: 'skills',
        items: [{
          name: 'brainstorming',
          display: {
            primary: 'brainstorming',
            secondary: 'superpowers:brainstorming - Explore intent before implementation',
            badge: 'System',
          },
          source_badge: 'System',
          match: { field: 'name', value: 'brainstorming', prefix: 'br' },
          completion: { replacement_input: '/skill superpowers:brainstorming ' },
        }],
      }],
    });
  });

  it('returns inactive suggestions outside command name drafts', () => {
    const catalog = createCommandCatalog({
      built_in_commands: [testCommand('review')],
    });

    expect(catalog.getCommandSuggestions({ draft_input: 'hello' })).toEqual({ type: 'inactive' });
    expect(catalog.getCommandSuggestions({ draft_input: 'hello /re' })).toEqual({ type: 'inactive' });
    expect(catalog.getCommandSuggestions({ draft_input: '/review ' })).toEqual({ type: 'inactive' });
    expect(catalog.getCommandSuggestions({ draft_input: '/review diff' })).toEqual({ type: 'inactive' });
  });
});

function testCommand(
  name: string,
  aliases?: string[],
  source: CommandDefinition['source'] = { kind: 'built_in' },
): CommandDefinition {
  return {
    name,
    ...(aliases ? { aliases } : {}),
    description: `${name} command`,
    source,
    async execute({ invocation }) {
      return {
        type: 'completed',
        message: invocation.raw_input,
      };
    },
  };
}

function createSkillSuggestionCommands(): CommandDefinition[] {
  return [{
    name: 'skill',
    description: 'Use a skill by skillId',
    source: { kind: 'built_in' },
    async execute({ invocation }) {
      return { type: 'completed', message: invocation.raw_input };
    },
  }, {
    name: 'brainstorming',
    aliases: ['brainstorm'],
    description: 'Explore intent before implementation',
    source: { kind: 'skill', skill_id: 'superpowers:brainstorming' },
    suggestion: {
      source_badge: 'System',
      replacement_input: '/skill superpowers:brainstorming ',
      primary: 'brainstorming',
      secondary: 'superpowers:brainstorming - Explore intent before implementation',
      badge: 'System',
    },
    async execute({ invocation }) {
      return { type: 'not_command', raw_input: invocation.raw_input };
    },
  }];
}
