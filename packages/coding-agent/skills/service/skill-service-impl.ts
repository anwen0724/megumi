/*
 * Implements SkillService by composing package discovery, availability state,
 * usage records, resource reads, and script execution request preparation.
 */

import type { Skill } from '../domain/model/skill';
import type { SkillRepository } from '../repository/skill-repository';
import type { SkillService } from './skill-service';
import type {
  ActivateSkillRequest,
  ActivateSkillResponse,
  DisableSkillRequest,
  DisableSkillResponse,
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
} from './skill-service-types';
import { readSkillPackages, type SkillRoot } from './internal/skill-package-reader';
import { readSkillResourceFile } from './internal/skill-resource-reader';
import { validateSkillScriptPath } from './internal/skill-path-policy';

export type SkillRootResolver = {
  resolveSkillRoots(request: { workspaceId?: string }): SkillRoot[];
};

export type CreateSkillServiceOptions = {
  repository: SkillRepository;
  rootResolver: SkillRootResolver;
  clock?: { now(): string };
  ids?: {
    skillAvailabilityId(): string;
    skillUsageRecordId(): string;
  };
};

export class SkillServiceImpl implements SkillService {
  constructor(private readonly options: CreateSkillServiceOptions) {}

  async listSkills(request: ListSkillsRequest): Promise<ListSkillsResponse> {
    try {
      return { status: 'ok', skills: this.loadSkills(request) };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to list skills.') };
    }
  }

  async getSkill(request: GetSkillRequest): Promise<GetSkillResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      return skill ? { status: 'ok', skill } : { status: 'not_found', skillId: request.skillId };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to get skill.') };
    }
  }

  async enableSkill(request: EnableSkillRequest): Promise<EnableSkillResponse> {
    return this.saveAvailability(request, true);
  }

  async disableSkill(request: DisableSkillRequest): Promise<DisableSkillResponse> {
    return this.saveAvailability(request, false);
  }

  async getSkillCatalog(request: GetSkillCatalogRequest): Promise<GetSkillCatalogResponse> {
    try {
      return {
        status: 'ok',
        skills: this.loadSkills(request)
          .filter((skill) => skill.available)
          .map((skill) => ({
            skillId: skill.skillId,
            name: skill.name,
            description: skill.description,
          })),
      };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to get skill catalog.') };
    }
  }

  async activateSkill(request: ActivateSkillRequest): Promise<ActivateSkillResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      if (!skill) {
        return { status: 'not_found', skillId: request.skillId };
      }
      if (!skill.available) {
        return { status: 'unavailable', skillId: request.skillId };
      }
      this.options.repository.saveUsageRecord({
        skillUsageRecordId: this.options.ids?.skillUsageRecordId() ?? `skill-usage-record:${crypto.randomUUID()}`,
        skillId: skill.skillId,
        sessionId: request.sessionId,
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        ...(request.runId ? { runId: request.runId } : {}),
        trigger: request.trigger,
        createdAt: this.now(),
      });
      return {
        status: 'ok',
        activatedSkill: {
          skillId: skill.skillId,
          name: skill.name,
          description: skill.description,
          content: skill.content,
        },
      };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to activate skill.') };
    }
  }

  async readSkillResource(request: ReadSkillResourceRequest): Promise<ReadSkillResourceResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      if (!skill) {
        return { status: 'not_found', skillId: request.skillId, resourcePath: request.resourcePath };
      }
      const result = readSkillResourceFile({
        packagePath: skill.packagePath,
        resourcePath: request.resourcePath,
      });
      if (result.status === 'ok') {
        return {
          status: 'ok',
          skillId: skill.skillId,
          resourcePath: request.resourcePath,
          content: result.content,
          contentType: result.contentType,
        };
      }
      if (result.status === 'not_allowed') {
        return {
          status: 'not_allowed',
          skillId: skill.skillId,
          resourcePath: request.resourcePath,
          message: result.message,
        };
      }
      if (result.status === 'not_found') {
        return { status: 'not_found', skillId: skill.skillId, resourcePath: request.resourcePath };
      }
      return { status: 'failed', message: result.message };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to read skill resource.') };
    }
  }

  async listSkillScripts(request: ListSkillScriptsRequest): Promise<ListSkillScriptsResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      return skill
        ? { status: 'ok', skillId: skill.skillId, scripts: skill.scripts }
        : { status: 'not_found', skillId: request.skillId };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to list skill scripts.') };
    }
  }

  async prepareSkillScriptExecution(
    request: PrepareSkillScriptExecutionRequest,
  ): Promise<PrepareSkillScriptExecutionResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      if (!skill) {
        return { status: 'not_found', skillId: request.skillId, scriptName: request.scriptName };
      }
      if (!skill.available) {
        return { status: 'unavailable', skillId: request.skillId };
      }
      const script = skill.scripts.find((candidate) => candidate.name === request.scriptName);
      if (!script) {
        return { status: 'not_found', skillId: request.skillId, scriptName: request.scriptName };
      }
      const validation = validateSkillScriptPath({
        packagePath: skill.packagePath,
        scriptPath: script.scriptPath,
      });
      if (validation.status === 'not_allowed') {
        return {
          status: 'not_allowed',
          skillId: request.skillId,
          scriptName: request.scriptName,
          message: validation.message,
        };
      }
      return {
        status: 'ok',
        executionRequest: {
          skillId: skill.skillId,
          scriptName: script.name,
          scriptPath: validation.absolutePath,
          args: [...request.args],
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...(request.runId ? { runId: request.runId } : {}),
          approvalSummary: `Run skill script ${script.name} from ${skill.skillId}`,
        },
      };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to prepare skill script execution.') };
    }
  }

  private async saveAvailability(
    request: EnableSkillRequest | DisableSkillRequest,
    available: boolean,
  ): Promise<EnableSkillResponse | DisableSkillResponse> {
    try {
      const skill = this.loadSkills(request).find((candidate) => candidate.skillId === request.skillId);
      if (!skill) {
        return { status: 'not_found', skillId: request.skillId };
      }
      const now = this.now();
      const existing = this.options.repository.findAvailability({
        skillId: request.skillId,
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      });
      const availability = this.options.repository.saveAvailability({
        skillAvailabilityId: existing?.skillAvailabilityId
          ?? this.options.ids?.skillAvailabilityId()
          ?? `skill-availability:${crypto.randomUUID()}`,
        skillId: request.skillId,
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        available,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return { status: 'ok', availability };
    } catch (error) {
      return { status: 'failed', message: messageFromError(error, 'Failed to save skill availability.') };
    }
  }

  private loadSkills(request: { workspaceId?: string }): Skill[] {
    const roots = this.options.rootResolver.resolveSkillRoots(request);
    const skills = readSkillPackages({ roots });
    const availabilityBySkill = new Map<string, boolean>();
    for (const availability of this.options.repository.listAvailabilityByWorkspace(request)) {
      availabilityBySkill.set(availability.skillId, availability.available);
    }
    return skills.map((skill) => ({
      ...skill,
      available: availabilityBySkill.get(skill.skillId) ?? skill.available,
    }));
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
