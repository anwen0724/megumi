import { describe, expect, it } from 'vitest';
import { createSkillCommands } from '@megumi/coding-agent/commands/core/skill-commands';

describe('createSkillCommands', () => {
  it('creates the stable /skill command and suggestion-only skill entries', () => {
    expect(createSkillCommands({
      skills: [{
        skillId: 'superpowers:brainstorming',
        commandName: 'brainstorming',
        skillName: 'superpowers:brainstorming',
        aliases: ['brainstorming'],
        description: 'Explore intent before implementation',
        sourceLabel: 'System',
      }],
    }).map((command) => ({
      name: command.name,
      aliases: command.aliases,
      description: command.description,
      source: command.source,
      suggestion: command.suggestion,
    }))).toEqual([
      {
        name: 'skill',
        aliases: undefined,
        description: 'Use a skill by skillId',
        source: { kind: 'built_in' },
        suggestion: undefined,
      },
      {
        name: 'brainstorming',
        aliases: ['brainstorming'],
        description: 'Explore intent before implementation',
        source: { kind: 'skill', skill_id: 'superpowers:brainstorming' },
        suggestion: {
          source_badge: 'System',
          replacement_input: '/skill superpowers:brainstorming ',
          primary: 'brainstorming',
          secondary: 'superpowers:brainstorming - Explore intent before implementation',
          badge: 'System',
        },
      },
    ]);
  });

  it('keeps the stable /skill command when no suggestions are provided', () => {
    expect(createSkillCommands().map((command) => command.name)).toEqual(['skill']);
  });
});
