/* Projects Skill catalog items into slash suggestions and one exact manual command. */

import type { CommandDefinition } from '../contracts/command-contracts';

export type SkillCommandDescriptor = {
  name: string;
  skillPath: string;
  description: string;
  sourceLabel: 'System' | 'User';
};

export function createSkillCommands(input: { skills?: readonly SkillCommandDescriptor[] } = {}): CommandDefinition[] {
  return [createStableSkillCommand(), ...(input.skills ?? []).map(createSkillSuggestionCommand)];
}

function createStableSkillCommand(): CommandDefinition {
  return {
    name: 'skill',
    description: 'Use a skill by its name',
    argument_hint: '<name> [task]',
    source: { kind: 'built_in' },
    hide_from_suggestions: true,
    async execute({ invocation, execution_context }) {
      const [name, ...argumentParts] = invocation.arguments_input.trim().split(/\s+/).filter(Boolean);
      if (!name) return { type: 'error', message: 'Usage: /skill <name> [task]' };
      const service = execution_context?.services?.skills;
      if (!service) return { type: 'error', message: 'Skill Service is unavailable.' };
      const listed = await service.listSkills({});
      if (listed.status === 'failed') return { type: 'error', message: listed.message };
      const matches = listed.skills.filter((skill) => skill.available && skill.name === name);
      if (matches.length === 0) return { type: 'error', message: `Skill not found: ${name}` };
      if (matches.length > 1) return { type: 'error', message: `Skill name is ambiguous: ${name}. Select it from the / menu.` };
      const skill = matches[0]!;
      const argumentsInput = argumentParts.join(' ');
      return {
        type: 'agent_run',
        input: {
          raw_input: argumentsInput,
          requestedSkill: { type: 'skill', name: skill.name, skillPath: skill.skillPath },
          command: {
            name: 'skill',
            source: { kind: 'skill', name: skill.name, skillPath: skill.skillPath },
            arguments_input: argumentsInput,
          },
        },
      };
    },
  };
}

function createSkillSuggestionCommand(skill: SkillCommandDescriptor): CommandDefinition {
  return {
    name: skill.name,
    description: skill.description,
    source: { kind: 'skill', name: skill.name, skillPath: skill.skillPath },
    suggestion: {
      source_badge: skill.sourceLabel,
      replacement_input: '',
      primary: skill.name,
      secondary: skill.description,
      badge: skill.sourceLabel,
    },
    async execute({ invocation }) {
      return { type: 'not_command', raw_input: invocation.raw_input };
    },
  };
}
