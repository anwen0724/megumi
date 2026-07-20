/* Defines path-based Context requests handled by a Root-bound SkillService. */

export type GetSkillCatalogContextRequest = Record<string, never>;

export type GetSkillResourceContextRequest = {
  skillPath: string;
  resourcePath: string;
};
