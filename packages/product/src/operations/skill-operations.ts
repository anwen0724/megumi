/* Implements Product Skill management operations using the Skills public interface. */
import {
  buildSkillPackageOverview,
  skillsFailureMessage,
  type Skill,
  type Skills,
  type SkillsFailure,
} from '@megumi/skills';
import type {
  SkillDetailUiDto,
  SkillHost,
  SkillListUiItem,
} from '../host/skill-host';

/** Creates the Product operations exposed through SkillHost. */
export function createSkillOperations(input: { readonly skills: Skills }): SkillHost {
  return {
    async listSkills(request) {
      const result = await input.skills.list({ workspaceId: request.workspaceId });
      return result.status === 'failed'
        ? toSkillFailure(result.failure)
        : { status: 'ok', skills: result.skills.map(toSkillListUiItem) };
    },
    async getSkillDetail(request) {
      const result = await input.skills.get({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skill: toSkillDetailUiDto(result.skill) };
    },
    async enableSkill(request) {
      const result = await input.skills.enable({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
    async disableSkill(request) {
      const result = await input.skills.disable({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.availability.skillPath };
    },
    async deleteSkill(request) {
      const result = await input.skills.delete({ skillPath: request.skillPath, workspaceId: request.workspaceId });
      if (result.status === 'failed' && result.failure.code === 'skill_not_found') {
        return { status: 'not_found', skillPath: request.skillPath };
      }
      if (result.status === 'failed' && result.failure.code === 'delete_not_allowed') {
        return { status: 'not_allowed', skillPath: request.skillPath, reason: result.failure.reason };
      }
      if (result.status === 'failed') return toSkillFailure(result.failure);
      return { status: 'ok', skillPath: result.skillPath };
    },
    async refreshSkills(request) {
      const result = await input.skills.refresh({ workspaceId: request.workspaceId });
      return result.status === 'failed' ? toSkillFailure(result.failure) : { status: 'ok' };
    },
  };
}

function toSkillListUiItem(skill: Skill): SkillListUiItem {
  const overview = buildSkillPackageOverview(skill);
  return {
    name: skill.name,
    description: skill.description,
    skillPath: skill.skillPath,
    sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
    available: skill.available,
    hasResources: overview.hasReferences || overview.hasAssets,
    hasScripts: overview.hasScripts,
    diagnostics: skill.diagnostics.map(({ level, message }) => ({ level, message })),
  };
}

function toSkillDetailUiDto(skill: Skill): SkillDetailUiDto {
  const overview = buildSkillPackageOverview(skill);
  return {
    ...toSkillListUiItem(skill),
    content: skill.content,
    resourcePaths: [
      ...(overview.hasReferences ? ['references/'] : []),
      ...(overview.hasAssets ? ['assets/'] : []),
    ],
    scriptNames: overview.hasScripts ? ['scripts/'] : [],
  };
}

function toSkillFailure(failure: SkillsFailure) {
  return {
    status: 'failed' as const,
    failure: { code: failure.code, message: skillsFailureMessage(failure) },
  };
}
