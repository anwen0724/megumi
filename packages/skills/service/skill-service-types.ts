/* Defines path-based request and response contracts for the Root-bound SkillService. */

import type { Skill, SkillScript } from '../domain/model/skill';
import type { SkillAvailability } from '../domain/entity/skill-availability';
import type { SkillScriptExecutionRequest } from '../domain/dto/tool/skill-tool-response';
import type { SkillCatalogItem, UsedSkillContent } from '../domain/dto/context/skill-context-response';

export type { SkillCatalogItem, UsedSkillContent } from '../domain/dto/context/skill-context-response';

export type ListSkillsRequest = Record<string, never>;
export type ListSkillsResponse =
  | { status: 'ok'; skills: Skill[] }
  | { status: 'failed'; message: string };

export type GetSkillRequest = { skillPath: string };
export type GetSkillResponse =
  | { status: 'ok'; skill: Skill }
  | { status: 'not_found'; skillPath: string }
  | { status: 'failed'; message: string };

export type EnableSkillRequest = { skillPath: string };
export type EnableSkillResponse =
  | { status: 'ok'; availability: SkillAvailability }
  | { status: 'not_found'; skillPath: string }
  | { status: 'failed'; message: string };

export type DisableSkillRequest = { skillPath: string };
export type DisableSkillResponse =
  | { status: 'ok'; availability: SkillAvailability }
  | { status: 'not_found'; skillPath: string }
  | { status: 'failed'; message: string };

export type GetSkillCatalogRequest = Record<string, never>;
export type GetSkillCatalogResponse =
  | { status: 'ok'; skills: SkillCatalogItem[] }
  | { status: 'failed'; message: string };

export type UseSkillRequest = { skillPath: string };
export type UseSkillResponse =
  | { status: 'ok'; skill: UsedSkillContent }
  | { status: 'not_found'; skillPath: string }
  | { status: 'unavailable'; skillPath: string }
  | { status: 'failed'; message: string };

export type ReadSkillResourceRequest = { skillPath: string; resourcePath: string };
export type ReadSkillResourceResponse =
  | { status: 'ok'; skillPath: string; resourcePath: string; content: string; contentType: 'text' }
  | { status: 'not_found'; skillPath: string; resourcePath?: string }
  | { status: 'not_allowed'; skillPath: string; resourcePath: string; message: string }
  | { status: 'failed'; message: string };

export type ListSkillScriptsRequest = { skillPath: string };
export type ListSkillScriptsResponse =
  | { status: 'ok'; skillPath: string; scripts: SkillScript[] }
  | { status: 'not_found'; skillPath: string }
  | { status: 'failed'; message: string };

export type PrepareSkillScriptExecutionRequest = {
  skillPath: string;
  scriptName: string;
  args: string[];
};
export type PrepareSkillScriptExecutionResponse =
  | { status: 'ok'; executionRequest: SkillScriptExecutionRequest }
  | { status: 'not_found'; skillPath: string; scriptName?: string }
  | { status: 'unavailable'; skillPath: string }
  | { status: 'not_allowed'; skillPath: string; scriptName: string; message: string }
  | { status: 'failed'; message: string };
