import { describe, expect, it } from 'vitest';
import { createSkillCommands } from '@megumi/coding-agent/commands/core/skill-commands';
import {
  type CommandHandler,
} from '@megumi/coding-agent/commands';

describe('createSkillCommands', () => {
  it('converts exposed skill descriptors into command definitions', () => {
    const execute: CommandHandler = async ({ invocation }) => ({
      type: 'completed',
      message: `skill ${invocation.name}`,
    });

    expect(createSkillCommands({
      skills: [{
        skill_id: 'brainstorming',
        name: 'skill:brainstorming',
        aliases: ['brainstorming'],
        description: 'Explore intent before implementation',
        execute,
      }],
    })).toEqual([{
      name: 'skill:brainstorming',
      aliases: ['brainstorming'],
      description: 'Explore intent before implementation',
      source: { kind: 'skill', skill_id: 'brainstorming' },
      execute,
    }]);
  });

  it('does not create commands when no skills are provided', () => {
    expect(createSkillCommands()).toEqual([]);
  });
});
