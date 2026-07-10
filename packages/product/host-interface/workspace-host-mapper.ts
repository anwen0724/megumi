/*
 * Maps Workspace module facts into host-facing workspace UI DTOs.
 */
import type { Workspace } from '../../coding-agent/workspace';
import type { WorkspaceProjectUiDto } from './workspace-host-types';

export function toWorkspaceProjectUiDto(workspace: Workspace): WorkspaceProjectUiDto {
  return {
    projectId: workspace.workspace_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    rootPathKey: workspace.root_path_key,
    status: workspace.status,
    openedAt: workspace.created_at,
    lastActiveAt: workspace.last_opened_at,
  };
}
