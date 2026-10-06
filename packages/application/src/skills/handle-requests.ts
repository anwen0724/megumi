/*
 * Handles Skill management requests and projects discovered packages into UI results.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SkillDetailUiDto, SkillHost, SkillListUiItem } from './contracts';
import { skillsFailureMessage, type Skill, type Skills, type SkillsFailure } from './manage-skills';

interface SkillResources {
  readonly hasReferences: boolean;
  readonly hasAssets: boolean;
  readonly hasScripts: boolean;
}

/** Translates Skill management outcomes into the public request and response contract. */
export function createSkillOperations(input: { readonly skills: Skills }): SkillHost {
  return {
    async listSkills(request) {
      const result = await input.skills.list({ workspaceId: request.workspaceId });
      return result.status === 'failed'
        ? toSkillFailure(result.failure)
        : {
            status: 'ok',
            skills: result.skills.map((skill) =>
              toSkillListUiItem(skill, readSkillResources(skill.packagePath))),
          };
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

function toSkillListUiItem(skill: Skill, resources: SkillResources): SkillListUiItem {
  return {
    name: skill.name,
    description: skill.description,
    skillPath: skill.skillPath,
    sourceLabel: skill.source.owner === 'system' ? 'System' : 'User',
    available: skill.available,
    hasResources: resources.hasReferences || resources.hasAssets,
    hasScripts: resources.hasScripts,
    diagnostics: skill.diagnostics.map(({ level, message }) => ({ level, message })),
  };
}

function toSkillDetailUiDto(skill: Skill): SkillDetailUiDto {
  const resources = readSkillResources(skill.packagePath);
  return {
    ...toSkillListUiItem(skill, resources),
    content: skill.content,
    resourcePaths: [
      ...(resources.hasReferences ? ['references/'] : []),
      ...(resources.hasAssets ? ['assets/'] : []),
    ],
    scriptNames: resources.hasScripts ? ['scripts/'] : [],
  };
}

function toSkillFailure(failure: SkillsFailure) {
  return {
    status: 'failed' as const,
    failure: { code: failure.code, message: skillsFailureMessage(failure) },
  };
}

/** Reads the package directories exposed by Skill management. */
function readSkillResources(packagePath: string): SkillResources {
  return {
    hasReferences: directoryExists(path.join(packagePath, 'references')),
    hasAssets: directoryExists(path.join(packagePath, 'assets')),
    hasScripts: directoryExists(path.join(packagePath, 'scripts')),
  };
}

function directoryExists(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}
