/*
 * Converts skills exposed by the future Skill system into CommandDefinition
 * entries. This file does not read SKILL.md, scan skill directories, or own
 * skill validation.
 */

import type { CommandDefinition, CommandHandler } from '../contracts/command-contracts';

export type SkillCommandDescriptor = {
  skill_id: string;
  name: string;
  aliases?: string[];
  description: string;
  argument_hint?: string;
  execute: CommandHandler;
};

export function createSkillCommands(input: {
  skills?: readonly SkillCommandDescriptor[];
} = {}): CommandDefinition[] {
  return (input.skills ?? []).map((skill) => ({
    name: skill.name,
    ...(skill.aliases ? { aliases: [...skill.aliases] } : {}),
    description: skill.description,
    ...(skill.argument_hint ? { argument_hint: skill.argument_hint } : {}),
    source: { kind: 'skill', skill_id: skill.skill_id },
    execute: skill.execute,
  }));
}
