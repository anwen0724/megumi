/*
 * Implements SkillHost by mapping host requests to the Coding Agent Skill module.
 */
import type {
  Skill,
  SkillService,
} from '../../coding-agent/skills';
import type {
  DisableSkillUiRequest,
  DisableSkillUiResponse,
  EnableSkillUiRequest,
  EnableSkillUiResponse,
  GetSkillDetailUiRequest,
  GetSkillDetailUiResponse,
  ListSkillsUiRequest,
  ListSkillsUiResponse,
  SkillDetailUiDto,
  SkillListUiItem,
} from './skill-host-types';

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
