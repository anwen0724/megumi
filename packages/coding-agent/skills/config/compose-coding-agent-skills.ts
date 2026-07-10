/*
 * Composes the Skill module repository, service, and default root resolver.
 */

import path from 'node:path';
import type { MegumiDatabase } from '../../persistence/connection';
import type { WorkspaceService } from '../../workspace';
import { SkillRepository } from '../repository/skill-repository';
import type { SkillService } from '../service/skill-service';
import { SkillServiceImpl, type SkillRootResolver } from '../service/skill-service-impl';
import type { SkillRoot } from '../service/internal/skill-package-reader';

export function composeCodingAgentSkills(input: {
  database: MegumiDatabase;
  homePath: string;
  workspaceService: Pick<WorkspaceService, 'getWorkspace'>;
  rootsOverride?: SkillRoot[];
  clock?: { now(): string };
}): { skillService: SkillService; skillRepository: SkillRepository } {
  const skillRepository = new SkillRepository(input.database);
  const rootResolver = input.rootsOverride
    ? staticRootResolver(input.rootsOverride)
    : defaultSkillRootResolver({
        homePath: input.homePath,
        workspaceService: input.workspaceService,
      });
  const skillService = new SkillServiceImpl({
    repository: skillRepository,
    rootResolver,
    ...(input.clock ? { clock: input.clock } : {}),
  });
  return { skillService, skillRepository };
}

function staticRootResolver(roots: SkillRoot[]): SkillRootResolver {
  return {
    resolveSkillRoots: () => roots,
  };
}

function defaultSkillRootResolver(input: {
  homePath: string;
  workspaceService: Pick<WorkspaceService, 'getWorkspace'>;
}): SkillRootResolver {
  return {
    resolveSkillRoots(request) {
      const roots: SkillRoot[] = [
        {
          kind: 'system',
          rootPath: path.resolve(__dirname, '..', 'built-in-skills'),
        },
        {
          kind: 'user',
          rootPath: path.join(input.homePath, 'skills'),
        },
      ];
      if (request.workspaceId) {
        const workspace = input.workspaceService.getWorkspace({ workspace_id: request.workspaceId });
        if (workspace.status === 'found') {
          roots.push({
            kind: 'project',
            rootPath: path.join(workspace.workspace.root_path, '.megumi', 'skills'),
          });
        }
      }
      return roots;
    },
  };
}
