import type { Skill, SkillDiagnostic, SkillService } from '../../coding-agent/skills';

/*
 * Implements SkillHost by mapping host requests to the Coding Agent Skill module.
 */

export interface SkillHost {
  listSkills(request: ListSkillsUiRequest): Promise<ListSkillsUiResponse>;
  getSkillDetail(request: GetSkillDetailUiRequest): Promise<GetSkillDetailUiResponse>;
  enableSkill(request: EnableSkillUiRequest): Promise<EnableSkillUiResponse>;
  disableSkill(request: DisableSkillUiRequest): Promise<DisableSkillUiResponse>;
}

export function createSkillHost(
  skillService: Pick<SkillService, 'listSkills' | 'getSkill' | 'enableSkill' | 'disableSkill'>,
): SkillHost {
  return {
    async listSkills(request) {
      const result = await skillService.listSkills(request);
      if (result.status === 'failed') {
        return { status: 'failed', message: result.message };
      }
      return {
        status: 'ok',
        skills: result.skills.map(toSkillListUiItem),
      };
    },
    async getSkillDetail(request) {
      const result = await skillService.getSkill(request);
      if (result.status === 'not_found') {
        return { status: 'not_found', skillId: result.skillId };
      }
      if (result.status === 'failed') {
        return { status: 'failed', message: result.message };
      }
      return {
        status: 'ok',
        skill: toSkillDetailUiDto(result.skill),
      };
    },
    async enableSkill(request) {
      const result = await skillService.enableSkill(request);
      if (result.status === 'not_found') {
        return { status: 'not_found', skillId: result.skillId };
      }
      if (result.status === 'failed') {
        return { status: 'failed', message: result.message };
      }
      return { status: 'ok', skillId: result.availability.skillId };
    },
    async disableSkill(request) {
      const result = await skillService.disableSkill(request);
      if (result.status === 'not_found') {
        return { status: 'not_found', skillId: result.skillId };
      }
      if (result.status === 'failed') {
        return { status: 'failed', message: result.message };
      }
      return { status: 'ok', skillId: result.availability.skillId };
    },
  };
}

function toSkillListUiItem(skill: Skill): SkillListUiItem {
  return {
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    sourceLabel: skill.source.label,
    available: skill.available,
    hasResources: skill.resources.length > 0,
    hasScripts: skill.scripts.length > 0,
    diagnostics: skill.diagnostics,
  };
}

function toSkillDetailUiDto(skill: Skill): SkillDetailUiDto {
  return {
    ...toSkillListUiItem(skill),
    content: skill.content,
    resourcePaths: skill.resources.map((resource) => resource.resourcePath),
    scriptNames: skill.scripts.map((script) => script.name),
  };
}

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

export type SkillDiagnosticUiItem = SkillDiagnostic;

export type SkillListUiItem = {
  skillId: string;
  name: string;
  description: string;
  sourceLabel: string;
  available: boolean;
  hasResources: boolean;
  hasScripts: boolean;
  diagnostics: SkillDiagnosticUiItem[];
};

export type SkillDetailUiDto = SkillListUiItem & {
  content?: string;
  resourcePaths: string[];
  scriptNames: string[];
};

export type ListSkillsUiResponse =
  | { status: 'ok'; skills: SkillListUiItem[] }
  | { status: 'failed'; message: string };

export type GetSkillDetailUiResponse =
  | { status: 'ok'; skill: SkillDetailUiDto }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type EnableSkillUiResponse =
  | { status: 'ok'; skillId: string }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };

export type DisableSkillUiResponse =
  | { status: 'ok'; skillId: string }
  | { status: 'not_found'; skillId: string }
  | { status: 'failed'; message: string };
