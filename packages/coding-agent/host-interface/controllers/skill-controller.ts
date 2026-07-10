/*
 * Host skill controller. It maps UI skill requests to SkillService calls.
 */
import type {
  DisableSkillUiRequest,
  DisableSkillUiResponse,
  EnableSkillUiRequest,
  EnableSkillUiResponse,
  GetSkillDetailUiRequest,
  GetSkillDetailUiResponse,
  ListSkillsUiRequest,
  ListSkillsUiResponse,
  Skill,
  SkillDetailUiDto,
  SkillListUiItem,
  SkillService,
} from '../../skills';

export interface SkillController {
  listSkills(request: ListSkillsUiRequest): Promise<ListSkillsUiResponse>;
  getSkillDetail(request: GetSkillDetailUiRequest): Promise<GetSkillDetailUiResponse>;
  enableSkill(request: EnableSkillUiRequest): Promise<EnableSkillUiResponse>;
  disableSkill(request: DisableSkillUiRequest): Promise<DisableSkillUiResponse>;
}

export function createSkillController(
  skillService: Pick<SkillService, 'listSkills' | 'getSkill' | 'enableSkill' | 'disableSkill'>,
): SkillController {
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
