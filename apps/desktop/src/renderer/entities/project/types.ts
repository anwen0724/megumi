import type { WorkspaceProjectUiDto } from '@megumi/product/host-interface';

export type ProjectStatus = WorkspaceProjectUiDto['status'];
export type ProjectRecord = WorkspaceProjectUiDto;

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
  const openedAt = record.openedAt ?? record.lastActiveAt ?? new Date(0).toISOString();
  return {
    id: record.projectId,
    projectId: record.projectId,
    name: record.name,
    repoPath: record.rootPath,
    repoPathKey: record.projectId,
    status: record.status,
    createdAt: openedAt,
    lastOpenedAt: record.lastActiveAt ?? openedAt,
  };
}
