import type { ProjectRecord, ProjectStatus } from '@megumi/shared/project';

export interface Project {
  id: string;
  projectId: string;
  name: string;
  repoPath: string;
  repoPathKey: string;
  status: ProjectStatus;
  createdAt: string;
  lastOpenedAt: string;
}

export function projectFromRecord(record: ProjectRecord): Project {
  return {
    id: record.projectId,
    projectId: record.projectId,
    name: record.name,
    repoPath: record.repoPath,
    repoPathKey: record.repoPathKey,
    status: record.status,
    createdAt: record.createdAt,
    lastOpenedAt: record.lastOpenedAt,
  };
}

