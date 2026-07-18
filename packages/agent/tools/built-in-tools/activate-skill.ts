/* Activates a catalogued skill for the current Agent Run. */
import type { RawToolResult } from '../contracts/tool-contracts';
import { inputRecord, requireString } from './input';
import type { BuiltInToolContext } from './types';

export async function executeActivateSkill(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  if (!context.skillService || !context.runContext) {
    throw new Error('activate_skill requires SkillService and run context.');
  }
  const skillId = requireString(inputRecord(input), 'skillId');
  const result = await context.skillService.activateSkill({
    skillId,
    sessionId: context.runContext.sessionId,
    ...(context.runContext.workspaceId ? { workspaceId: context.runContext.workspaceId } : {}),
    runId: context.runContext.runId,
    trigger: 'model_tool',
  });

  if (result.status !== 'ok') {
    return {
      outputKind: 'error',
      content: `Skill activation failed: ${result.status}`,
      isError: true,
      metadata: { skillId, status: result.status },
    };
  }

  return {
    outputKind: 'json',
    content: {
      activated: true,
      skillId: result.activatedSkill.skillId,
      message: `Skill activated: ${result.activatedSkill.skillId}`,
    },
    runtimeSources: [{
      source_id: `skill:${result.activatedSkill.skillId}`,
      source_kind: 'skill',
      text: result.activatedSkill.content,
      persisted: false,
      metadata: {
        skillId: result.activatedSkill.skillId,
        name: result.activatedSkill.name,
        description: result.activatedSkill.description,
        origin_module: 'skills',
      },
    }],
  };
}
