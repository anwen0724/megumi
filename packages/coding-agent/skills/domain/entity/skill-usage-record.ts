/*
 * Defines the SkillUsageRecord entity backed by the skill_usage_record table.
 */

export type SkillUsageRecordTrigger = 'command' | 'model_tool';

export type SkillUsageRecord = {
  skillUsageRecordId: string;
  skillId: string;
  sessionId: string;
  workspaceId?: string;
  runId?: string;
  trigger: SkillUsageRecordTrigger;
  createdAt: string;
};
