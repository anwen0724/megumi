/* Defines the lightweight catalog and full used-Skill content exposed to Context. */

export type SkillCatalogItem = {
  name: string;
  description: string;
  skillPath: string;
};

export type UsedSkillContent = {
  name: string;
  skillPath: string;
  content: string;
};

export type SkillResourceContextItem = {
  skillPath: string;
  resourcePath: string;
  content: string;
  contentType: 'text';
};

export type GetSkillCatalogContextResponse =
  | { status: 'ok'; skills: SkillCatalogItem[] }
  | { status: 'failed'; message: string };

export type GetSkillResourceContextResponse =
  | { status: 'ok'; resource: SkillResourceContextItem }
  | { status: 'not_found'; skillPath: string; resourcePath: string }
  | { status: 'failed'; message: string };
