import type { ProjectRecord, ProjectStatus } from '@megumi/shared/project-contracts';

export interface Project extends ProjectRecord {
  id: string;
  status: ProjectStatus;
  description?: string;
  type?: string;
  context?: Record<string, unknown>;
}

export function projectFromRecord(record: ProjectRecord): Project {
  return {
    ...record,
    id: record.projectId,
  };
}
