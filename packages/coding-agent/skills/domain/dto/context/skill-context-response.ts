/*
 * Defines Context module response DTOs for Skill catalog and resources.
 */

export type SkillCatalogItem = {
  skillId: string;
  name: string;
  description: string;
};

export type ActivatedSkillContextItem = {
  skillId: string;
  name: string;
  description: string;
  content: string;
};

export type SkillResourceContextItem = {
  skillId: string;
  resourcePath: string;
  content: string;
  contentType: 'text';
};

export type GetSkillCatalogContextResponse =
  | { status: 'ok'; skills: SkillCatalogItem[] }
  | { status: 'failed'; message: string };

export type GetSkillResourceContextResponse =
  | { status: 'ok'; resource: SkillResourceContextItem }
  | { status: 'not_found'; skillId: string; resourcePath: string }
  | { status: 'failed'; message: string };
