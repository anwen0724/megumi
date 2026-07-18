/*
 * Converts skills exposed by the Skill system into slash command definitions
 * and suggestion-only entries. It does not scan skill directories or activate skills.
 */

import type { CommandDefinition } from '../contracts/command-contracts';

export type SkillCommandDescriptor = {
  skillId: string;
  commandName: string;
  skillName: string;
  aliases?: string[];
  description: string;
  sourceLabel: string;
};

export function createSkillCommands(input: {
  skills?: readonly SkillCommandDescriptor[];
} = {}): CommandDefinition[] {
  return [
    createStableSkillCommand(),
    ...(input.skills ?? []).map(createSkillSuggestionCommand),
  ];
}

function createStableSkillCommand(): CommandDefinition {
  return {
    name: 'skill',
    description: 'Use a skill by skillId',
    argument_hint: '<skillId> [args]',
    source: { kind: 'built_in' },
    hide_from_suggestions: true,
    async execute({ invocation }) {
      const [skillId, ...argumentParts] = invocation.arguments_input.trim().split(/\s+/).filter(Boolean);
      if (!skillId) {
        return { type: 'error', message: 'Usage: /skill <skillId> [args]' };
      }
      const argumentsInput = argumentParts.join(' ');
      return {
        type: 'agent_run',
        input: {
          raw_input: invocation.raw_input,
          requestedSkillActivation: {
            skillId,
            trigger: 'command',
          },
          command: {
            name: 'skill',
            source: { kind: 'skill', skill_id: skillId },
            arguments_input: argumentsInput,
          },
        },
      };
    },
  };
}

function createSkillSuggestionCommand(skill: SkillCommandDescriptor): CommandDefinition {
  return {
    name: skill.commandName,
    ...(skill.aliases ? { aliases: [...skill.aliases] } : {}),
    description: skill.description,
    source: { kind: 'skill', skill_id: skill.skillId },
    suggestion: {
      source_badge: skill.sourceLabel,
      replacement_input: `/skill ${skill.skillId} `,
      primary: skill.commandName,
      secondary: `${skill.skillName} - ${skill.description}`,
      badge: skill.sourceLabel,
    },
    async execute({ invocation }) {
      return { type: 'not_command', raw_input: invocation.raw_input };
    },
  };
}
