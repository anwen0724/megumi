// Renderer-facing project DTOs.
export type ProjectStatus = 'available' | 'missing' | 'active' | 'archived';

export interface ProjectRecord {
  projectId: string;
  name: string;
  repoPath: string;
  repoPathKey?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt?: string;
  lastOpenedAt: string;
}
