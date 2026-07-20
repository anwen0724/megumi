/* Owns one Root-bound Skill snapshot, availability reconciliation, use, and explicit User deletion. */

import fs from 'node:fs';
import path from 'node:path';
import type { Skill } from '../domain/model/skill';
import type { SkillCatalogItem } from '../domain/dto/context/skill-context-response';
import type { SkillRepository } from '../repository/skill-repository';
import type { SkillService } from './skill-service';
import type {
  DisableSkillRequest,
  DisableSkillResponse,
  DeleteSkillRequest,
  DeleteSkillResponse,
  EnableSkillRequest,
  EnableSkillResponse,
  GetSkillCatalogRequest,
  GetSkillCatalogResponse,
  GetSkillRequest,
  GetSkillResponse,
  ListSkillScriptsRequest,
  ListSkillScriptsResponse,
  ListSkillsRequest,
  ListSkillsResponse,
  PrepareSkillScriptExecutionRequest,
  PrepareSkillScriptExecutionResponse,
  ReadSkillResourceRequest,
  ReadSkillResourceResponse,
  UseSkillRequest,
  UseSkillResponse,
} from './skill-service-types';
import { normalizeSkillPath, readSkillPackages, type SkillRoot } from './internal/skill-package-reader';
import { readSkillResourceFile } from './internal/skill-resource-reader';
import { validateSkillScriptPath } from './internal/skill-path-policy';

export type CreateSkillServiceOptions = {
  repository: SkillRepository;
  roots: SkillRoot[];
  clock?: { now(): string };
  ids?: { skillAvailabilityId(): string };
};

export class SkillServiceImpl implements SkillService {
  private skills: Skill[];

  constructor(private readonly options: CreateSkillServiceOptions) {
    const discoveredSkills = readSkillPackages({ roots: options.roots });
    const availabilityRecords = options.repository.listAvailability();
    const currentAvailabilityRecords = availabilityRecords.filter((record) => {
      if (belongsToReadableRoot(record.skillPath, options.roots) && isMissingSkillFile(record.skillPath)) {
        options.repository.deleteAvailability({ skillPath: record.skillPath });
        return false;
      }
      return true;
    });
    const availability = new Map(currentAvailabilityRecords
      .map((item) => [comparablePath(item.skillPath), item.available]));
    this.skills = discoveredSkills.map((skill) => ({
      ...skill,
      available: availability.get(comparablePath(skill.skillPath)) ?? skill.available,
    }));
  }

  async listSkills(_request: ListSkillsRequest): Promise<ListSkillsResponse> {
    return { status: 'ok', skills: this.skills.map(cloneSkill) };
  }

  async getSkill(request: GetSkillRequest): Promise<GetSkillResponse> {
    const skill = this.findSkill(request.skillPath);
    return skill ? { status: 'ok', skill: cloneSkill(skill) } : { status: 'not_found', skillPath: request.skillPath };
  }

  async enableSkill(request: EnableSkillRequest): Promise<EnableSkillResponse> {
    return this.saveAvailability(request, true);
  }

  async disableSkill(request: DisableSkillRequest): Promise<DisableSkillResponse> {
    return this.saveAvailability(request, false);
  }

  async deleteSkill(request: DeleteSkillRequest): Promise<DeleteSkillResponse> {
    const skill = this.findSkill(request.skillPath);
    if (!skill) return { status: 'not_found', skillPath: request.skillPath };
    if (skill.source.owner !== 'user') {
      return { status: 'not_allowed', skillPath: skill.skillPath, reason: 'system_skill' };
    }
    const userRoot = this.options.roots.find((root) => root.owner === 'user' && rootContainsSkill(root, skill.skillPath));
    if (!userRoot) return { status: 'not_allowed', skillPath: skill.skillPath, reason: 'skill_root' };
    const packageDirectory = path.dirname(skill.skillPath);
    if (comparablePath(packageDirectory) === comparablePath(userRoot.rootPath)) {
      return { status: 'not_allowed', skillPath: skill.skillPath, reason: 'skill_root' };
    }
    try {
      fs.rmSync(packageDirectory, { recursive: true, force: false });
      this.options.repository.deleteAvailability({ skillPath: skill.skillPath });
      this.skills = this.skills.filter((item) => comparablePath(item.skillPath) !== comparablePath(skill.skillPath));
      return { status: 'ok', skillPath: skill.skillPath };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to delete Skill package.') };
    }
  }

  async getSkillCatalog(_request: GetSkillCatalogRequest): Promise<GetSkillCatalogResponse> {
    return {
      status: 'ok',
      skills: this.skills.filter((skill) => skill.available).map((skill): SkillCatalogItem => ({
        name: skill.name,
        description: skill.description,
        skillPath: skill.skillPath,
      })),
    };
  }

  async useSkill(request: UseSkillRequest): Promise<UseSkillResponse> {
    const skill = this.findSkill(request.skillPath);
    if (!skill) return { status: 'not_found', skillPath: request.skillPath };
    if (!skill.available) return { status: 'unavailable', skillPath: request.skillPath };
    return { status: 'ok', skill: { name: skill.name, skillPath: skill.skillPath, content: skill.content } };
  }

  async readSkillResource(request: ReadSkillResourceRequest): Promise<ReadSkillResourceResponse> {
    const skill = this.findSkill(request.skillPath);
    if (!skill) return { status: 'not_found', skillPath: request.skillPath, resourcePath: request.resourcePath };
    const result = readSkillResourceFile({ skillPath: skill.skillPath, resourcePath: request.resourcePath });
    if (result.status === 'ok') return { status: 'ok', skillPath: skill.skillPath, resourcePath: request.resourcePath, content: result.content, contentType: result.contentType };
    if (result.status === 'not_allowed') return { status: 'not_allowed', skillPath: skill.skillPath, resourcePath: request.resourcePath, message: result.message };
    if (result.status === 'not_found') return { status: 'not_found', skillPath: skill.skillPath, resourcePath: request.resourcePath };
    return { status: 'failed', message: result.message };
  }

  async listSkillScripts(request: ListSkillScriptsRequest): Promise<ListSkillScriptsResponse> {
    const skill = this.findSkill(request.skillPath);
    return skill
      ? { status: 'ok', skillPath: skill.skillPath, scripts: skill.scripts.map((script) => ({ ...script })) }
      : { status: 'not_found', skillPath: request.skillPath };
  }

  async prepareSkillScriptExecution(request: PrepareSkillScriptExecutionRequest): Promise<PrepareSkillScriptExecutionResponse> {
    const skill = this.findSkill(request.skillPath);
    if (!skill) return { status: 'not_found', skillPath: request.skillPath, scriptName: request.scriptName };
    if (!skill.available) return { status: 'unavailable', skillPath: skill.skillPath };
    const script = skill.scripts.find((candidate) => candidate.name === request.scriptName);
    if (!script) return { status: 'not_found', skillPath: skill.skillPath, scriptName: request.scriptName };
    const validation = validateSkillScriptPath({ skillPath: skill.skillPath, scriptPath: script.scriptPath });
    if (validation.status === 'not_allowed') {
      return { status: 'not_allowed', skillPath: skill.skillPath, scriptName: request.scriptName, message: validation.message };
    }
    return {
      status: 'ok',
      executionRequest: {
        skillPath: skill.skillPath,
        scriptName: script.name,
        scriptPath: validation.absolutePath,
        args: [...request.args],
        approvalSummary: `Run skill script ${script.name} from ${skill.name}`,
      },
    };
  }

  private async saveAvailability(
    request: EnableSkillRequest | DisableSkillRequest,
    available: boolean,
  ): Promise<EnableSkillResponse | DisableSkillResponse> {
    const skill = this.findSkill(request.skillPath);
    if (!skill) return { status: 'not_found', skillPath: request.skillPath };
    try {
      const existing = this.options.repository.findAvailability({ skillPath: skill.skillPath });
      const availability = this.options.repository.saveAvailability({
        skillAvailabilityId: existing?.skillAvailabilityId
          ?? this.options.ids?.skillAvailabilityId()
          ?? `skill-availability:${crypto.randomUUID()}`,
        skillPath: skill.skillPath,
        available,
        updatedAt: this.now(),
      });
      // Copy-on-write changes only this root-bound view. Other Run instances keep their snapshot.
      this.skills = this.skills.map((item) => comparablePath(item.skillPath) === comparablePath(skill.skillPath)
        ? { ...item, available }
        : item);
      return { status: 'ok', availability };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to save skill availability.') };
    }
  }

  private findSkill(skillPath: string): Skill | undefined {
    const key = comparablePath(skillPath);
    return this.skills.find((skill) => comparablePath(skill.skillPath) === key);
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function cloneSkill(skill: Skill): Skill {
  return {
    ...skill,
    source: { ...skill.source },
    resources: skill.resources.map((resource) => ({ ...resource })),
    scripts: skill.scripts.map((script) => ({ ...script })),
    diagnostics: skill.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  };
}

function comparablePath(value: string): string {
  const normalized = normalizeSkillPath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function belongsToReadableRoot(skillPath: string, roots: SkillRoot[]): boolean {
  return roots.some((root) => canReadDirectory(root.rootPath) && rootContainsSkill(root, skillPath));
}

function rootContainsSkill(root: SkillRoot, skillPath: string): boolean {
  const normalizedRoot = normalizeSkillPath(root.rootPath);
  const normalizedSkillPath = path.resolve(skillPath);
  const relativePath = path.relative(normalizedRoot, normalizedSkillPath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return false;
  }
  const firstDirectory = relativePath.split(path.sep)[0];
  const excluded = root.excludedDirectoryNames ?? [];
  return !excluded.some((name) => process.platform === 'win32'
    ? name.toLowerCase() === firstDirectory.toLowerCase()
    : name === firstDirectory);
}

function canReadDirectory(targetPath: string): boolean {
  try {
    if (!fs.statSync(targetPath).isDirectory()) return false;
    fs.readdirSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isMissingSkillFile(targetPath: string): boolean {
  try {
    return !fs.statSync(targetPath).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
