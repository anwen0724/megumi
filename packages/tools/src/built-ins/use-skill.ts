/* Loads one catalogued Skill through the current Run's Root-bound Skills interface. */
import type { RawToolResult, ToolDefinition } from '../tool';
import { inputRecord, requireString } from './tool-input';
import type { BuiltInToolContext } from './workspace-file-access';

export const useSkillToolDefinition: ToolDefinition = {
  name: 'use_skill',
  title: 'Use skill',
  description: 'Load a skill by its exact skillPath.',
  inputSchema: {
    type: 'object',
    properties: { skillPath: { type: 'string', description: 'Exact skillPath of the skill to load.' } },
    required: ['skillPath'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      used: { type: 'boolean' }, name: { type: 'string' },
      skillPath: { type: 'string' }, message: { type: 'string' },
    },
    required: ['used', 'name', 'skillPath', 'message'],
  },
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  capabilities: ['project_read'],
  riskLevel: 'low',
  sideEffect: 'none',
  availability: { status: 'available' },
  executionMode: 'serial',
  permissionMetadata: { ruleToolName: 'use_skill' },
  modelFacingDescription: 'Load a skill by its exact skillPath.',
};

export async function executeUseSkill(
  context: BuiltInToolContext,
  input: unknown,
): Promise<RawToolResult> {
  if (!context.skills) throw new Error('use_skill requires the current Run Skills interface.');
  const skillPath = requireString(inputRecord(input), 'skillPath');
  const result = await context.skills.useSkill({ skillPath });

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
      sourceId: `skill:${result.skill.skillPath}`,
      sourceKind: 'skill',
      text: result.skill.content,
      persisted: false,
      metadata: {
        name: result.skill.name,
        skillPath: result.skill.skillPath,
        originModule: 'skills',
      },
    }],
  };
}
