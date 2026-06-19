// Renderer-facing project DTOs.
export type ProjectStatus = 'available' | 'missing';

export interface ProjectRecord {
  projectId: string;
  name: string;
  repoPath: string;
  repoPathKey: string;
  status: ProjectStatus;
  createdAt: string;
  lastOpenedAt: string;
}
