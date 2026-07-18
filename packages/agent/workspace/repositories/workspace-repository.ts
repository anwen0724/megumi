/*
 * Workspace-owned repository for the workspaces table. Persistence owns the
 * database connection and migrations; this module owns Workspace row mapping.
 */
import type { MegumiDatabase } from '../../persistence/connection';
import type { Workspace } from '../contracts/workspace-contracts';

interface WorkspaceRow {
  workspace_id: string;
  name: string;
  root_path: string;
  root_path_key: string;
  status: Workspace['status'];
  created_at: string;
  updated_at: string;
  last_opened_at: string;
}

export class WorkspaceRepository {
  constructor(private readonly database: MegumiDatabase) {}

  insertOrUpdateWorkspace(workspace: Workspace): Workspace {
    this.database.prepare(`
      INSERT INTO workspaces (
        workspace_id, name, root_path, root_path_key, status,
        created_at, updated_at, last_opened_at
      ) VALUES (
        @workspace_id, @name, @root_path, @root_path_key, @status,
        @created_at, @updated_at, @last_opened_at
      )
      ON CONFLICT(root_path_key) DO UPDATE SET
        name = excluded.name,
        root_path = excluded.root_path,
        status = excluded.status,
        updated_at = excluded.updated_at,
        last_opened_at = excluded.last_opened_at
    `).run(toWorkspaceRow(workspace));

    return this.findWorkspaceByRootPathKey(workspace.root_path_key) ?? workspace;
  }

  findWorkspaceById(workspace_id: string): Workspace | undefined {
    const row = this.database.prepare('SELECT * FROM workspaces WHERE workspace_id = ?')
      .get(workspace_id) as WorkspaceRow | undefined;
    return row ? fromWorkspaceRow(row) : undefined;
  }

  findWorkspaceByRootPathKey(root_path_key: string): Workspace | undefined {
    const row = this.database.prepare('SELECT * FROM workspaces WHERE root_path_key = ?')
      .get(root_path_key) as WorkspaceRow | undefined;
    return row ? fromWorkspaceRow(row) : undefined;
  }

  listWorkspaces(): Workspace[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspaces
      ORDER BY last_opened_at DESC, name ASC
    `).all() as WorkspaceRow[]).map(fromWorkspaceRow);
  }

  updateWorkspaceStatus(input: {
    workspace_id: string;
    status: Workspace['status'];
    updated_at: string;
  }): Workspace | undefined {
    this.database.prepare(`
      UPDATE workspaces
      SET status = @status,
          updated_at = @updated_at
      WHERE workspace_id = @workspace_id
    `).run(input);
    return this.findWorkspaceById(input.workspace_id);
  }

  touchWorkspace(input: { workspace_id: string; opened_at: string }): Workspace | undefined {
    this.database.prepare(`
      UPDATE workspaces
      SET updated_at = @opened_at,
          last_opened_at = @opened_at
      WHERE workspace_id = @workspace_id
    `).run(input);
    return this.findWorkspaceById(input.workspace_id);
  }

  deleteWorkspace(workspace_id: string): 'deleted' | 'not_found' | 'blocked' {
    if (!this.findWorkspaceById(workspace_id)) {
      return 'not_found';
    }
    if (this.workspaceHasBusinessFactReferences(workspace_id)) {
      return 'blocked';
    }
    const result = this.database.prepare('DELETE FROM workspaces WHERE workspace_id = ?')
      .run(workspace_id);
    return result.changes > 0 ? 'deleted' : 'not_found';
  }

  private workspaceHasBusinessFactReferences(workspace_id: string): boolean {
    const row = this.database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE workspace_id = @workspace_id)
        + (SELECT COUNT(*) FROM workspace_changes WHERE workspace_id = @workspace_id)
        AS reference_count
    `).get({ workspace_id }) as { reference_count: number } | undefined;
    return Number(row?.reference_count ?? 0) > 0;
  }
}

function toWorkspaceRow(workspace: Workspace): WorkspaceRow {
  return {
    workspace_id: workspace.workspace_id,
    name: workspace.name,
    root_path: workspace.root_path,
    root_path_key: workspace.root_path_key,
    status: workspace.status,
    created_at: workspace.created_at,
    updated_at: workspace.updated_at,
    last_opened_at: workspace.last_opened_at,
  };
}

function fromWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    workspace_id: row.workspace_id,
    name: row.name,
    root_path: row.root_path,
    root_path_key: row.root_path_key,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_opened_at: row.last_opened_at,
  };
}
