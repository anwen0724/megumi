/* Loads one catalogued Skill through the current Run's Root-bound SkillService. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, requireString } from './input';
import type { BuiltInToolContext } from './types';

export async function executeUseSkill(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  if (!context.skillService) throw new Error('use_skill requires the current Run SkillService.');
  const skillPath = requireString(inputRecord(input), 'skillPath');
  const result = await context.skillService.useSkill({ skillPath });

  if (result.status !== 'ok') {
    return {
      outputKind: 'error',
      content: `Skill use failed: ${result.status}`,
      isError: true,
      metadata: { skillPath, status: result.status },
    };
  }

  return {
    outputKind: 'json',
    content: {
      used: true,
      name: result.skill.name,
      skillPath: result.skill.skillPath,
      message: `Skill loaded: ${result.skill.name}`,
    },
    runtimeSources: [{
      source_id: `skill:${result.skill.skillPath}`,
      source_kind: 'skill',
      text: result.skill.content,
      persisted: false,
      metadata: {
        name: result.skill.name,
        skillPath: result.skill.skillPath,
        origin_module: 'skills',
      },
    }],
  };
}
