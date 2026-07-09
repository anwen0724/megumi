/*
 * Defines UI and host-interface request DTOs for Skill operations.
 */

export type ListSkillsUiRequest = {
  workspaceId?: string;
};

export type GetSkillDetailUiRequest = {
  skillId: string;
  workspaceId?: string;
};

export type EnableSkillUiRequest = {
  skillId: string;
  workspaceId?: string;
};

export type DisableSkillUiRequest = {
  skillId: string;
  workspaceId?: string;
  reason?: string;
};
