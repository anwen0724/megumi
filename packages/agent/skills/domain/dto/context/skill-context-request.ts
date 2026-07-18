/*
 * Defines Context module request DTOs for Skill catalog and resources.
 */

export type GetSkillCatalogContextRequest = {
  workspaceId?: string;
};

export type GetSkillResourceContextRequest = {
  skillId: string;
  resourcePath: string;
  workspaceId?: string;
};
