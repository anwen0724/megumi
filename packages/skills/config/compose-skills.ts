/* Composes Root-bound SkillService instances from Megumi Home and an optional Workspace root. */

import path from 'node:path';
import { SkillRepository, type SkillDatabase } from '../repository/skill-repository';
import type { SkillService } from '../service/skill-service';
import { SkillServiceImpl } from '../service/skill-service-impl';
import type { SkillRoot } from '../service/internal/skill-package-reader';

export type SkillComposition = {
  skillRepository: SkillRepository;
  createSkillService(input?: { workspaceRoot?: string; rootsOverride?: SkillRoot[] }): SkillService;
};

export function composeSkills(input: {
  database: SkillDatabase;
  homePath: string;
  clock?: { now(): string };
  ids?: { skillAvailabilityId(): string };
}): SkillComposition {
  const skillRepository = new SkillRepository(input.database);
  return {
    skillRepository,
    createSkillService(request = {}) {
      const roots = request.rootsOverride ?? defaultSkillRoots({
        homePath: input.homePath,
        ...(request.workspaceRoot ? { workspaceRoot: request.workspaceRoot } : {}),
      });
      return new SkillServiceImpl({
        repository: skillRepository,
        roots,
        ...(input.clock ? { clock: input.clock } : {}),
        ...(input.ids ? { ids: input.ids } : {}),
      });
    },
  };
}

function defaultSkillRoots(input: { homePath: string; workspaceRoot?: string }): SkillRoot[] {
  return [
    { owner: 'system', rootPath: path.join(input.homePath, 'skills', '.system') },
    { owner: 'user', rootPath: path.join(input.homePath, 'skills'), excludedDirectoryNames: ['.system'] },
    ...(input.workspaceRoot
      ? [{ owner: 'user' as const, rootPath: path.join(input.workspaceRoot, '.megumi', 'skills') }]
      : []),
  ];
}
