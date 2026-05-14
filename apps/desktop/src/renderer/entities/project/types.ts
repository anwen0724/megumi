export interface Project {
  id: string;
  name: string;
  description: string;
  repoPath: string | null;
  type: 'new_project' | 'existing_feature';
  createdAt: string;
  context: Record<string, unknown>;
}
