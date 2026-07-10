/*
 * Defines request and response types for the SkillService business API.
 */

import type { Skill, SkillScript } from '../domain/model/skill';
import type { SkillAvailability } from '../domain/entity/skill-availability';
import type { SkillScriptExecutionRequest } from '../domain/dto/tool/skill-tool-response';

export type ListSkillsRequest = { workspaceId?: string };
export type ListSkillsResponse =
  | { status: 'ok'; skills: Skill[] }
  | { status: 'failed'; message: string };

export type GetSkillRequest = { skillId: string; workspaceId?: string };
export type GetSkillResponse =
  | { status: 'ok'; skill: Skill }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type EnableSkillRequest = { skillId: string; workspaceId?: string };
export type EnableSkillResponse =
  | { status: 'ok'; availability: SkillAvailability }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type DisableSkillRequest = { skillId: string; workspaceId?: string };
export type DisableSkillResponse =
  | { status: 'ok'; availability: SkillAvailability }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type GetSkillCatalogRequest = { workspaceId?: string };
export type SkillCatalogItem = { skillId: string; name: string; description: string };
export type GetSkillCatalogResponse =
  | { status: 'ok'; skills: SkillCatalogItem[] }
  | { status: 'failed'; message: string };

export type ActivateSkillRequest = {
  skillId: string;
  sessionId: string;
  workspaceId?: string;
  runId?: string;
  trigger: 'command' | 'model_tool';
};

export type ActivatedSkillContent = {
  skillId: string;
  name: string;
  description: string;
  content: string;
};

export type ActivateSkillResponse =
  | { status: 'ok'; activatedSkill: ActivatedSkillContent }
  | { status: 'not_found'; skillId: string }
  | { status: 'unavailable'; skillId: string }
  | { status: 'failed'; message: string };

export type ReadSkillResourceRequest = {
  skillId: string;
  resourcePath: string;
  workspaceId?: string;
};
export type ReadSkillResourceResponse =
  | { status: 'ok'; skillId: string; resourcePath: string; content: string; contentType: 'text' }
  | { status: 'not_found'; skillId: string; resourcePath?: string }
  | { status: 'not_allowed'; skillId: string; resourcePath: string; message: string }
  | { status: 'failed'; message: string };

export type ListSkillScriptsRequest = { skillId: string; workspaceId?: string };
export type ListSkillScriptsResponse =
  | { status: 'ok'; skillId: string; scripts: SkillScript[] }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type PrepareSkillScriptExecutionRequest = {
  skillId: string;
  scriptName: string;
  args: string[];
  workspaceId: string;
  sessionId: string;
  runId?: string;
};
export type PrepareSkillScriptExecutionResponse =
  | { status: 'ok'; executionRequest: SkillScriptExecutionRequest }
  | { status: 'not_found'; skillId: string; scriptName?: string }
  | { status: 'unavailable'; skillId: string }
  | { status: 'not_allowed'; skillId: string; scriptName: string; message: string }
  | { status: 'failed'; message: string };
