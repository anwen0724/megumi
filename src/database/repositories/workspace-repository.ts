// Implements workspace-owned repository ports with SQLite metadata rows and JSON domain snapshots.
import type {
  Workspace,
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceRepository,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
} from '../../workspace';
import type { SqliteDatabase } from '../connection';
import { decodeJsonField } from '../json';
import { runInTransaction } from '../transaction';

interface JsonRow {
  id: string;
  value_json: string;
}

export class SqliteWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.database.prepare(`
      INSERT INTO workspaces (id, project_root, name, status, created_at, updated_at, workspace_json)
      VALUES (@id, @projectRoot, @name, @status, @createdAt, @updatedAt, @workspaceJson)
      ON CONFLICT(id) DO UPDATE SET
        project_root = excluded.project_root,
        name = excluded.name,
        status = excluded.status,
        updated_at = excluded.updated_at,
        workspace_json = excluded.workspace_json
    `).run({
      id: String(workspace.id),
      projectRoot: workspace.projectRoot,
      name: workspace.name ?? null,
      status: workspace.status,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      workspaceJson: JSON.stringify(workspace),
    });
  }

  async getWorkspace(id: string): Promise<Workspace | undefined> {
    const row = this.database.prepare('SELECT id, workspace_json AS value_json FROM workspaces WHERE id = ?').get(id) as
      | JsonRow
      | undefined;
    return row ? mapJson<Workspace>(row, 'workspaces') : undefined;
  }

  async saveChangeSet(changeSet: WorkspaceChangeSet): Promise<void> {
    runInTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO workspace_change_sets (
          id, workspace_id, session_id, run_id, tool_call_id, tool_execution_id, status,
          changed_file_count, created_at, updated_at, finalized_at, change_set_json
        ) VALUES (
          @id, @workspaceId, @sessionId, @runId, @toolCallId, @toolExecutionId, @status,
          @changedFileCount, @createdAt, @updatedAt, @finalizedAt, @changeSetJson
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          changed_file_count = excluded.changed_file_count,
          updated_at = excluded.updated_at,
          finalized_at = excluded.finalized_at,
          change_set_json = excluded.change_set_json
      `).run({
        id: String(changeSet.id),
        workspaceId: String(changeSet.workspaceId),
        sessionId: changeSet.sessionId ?? null,
        runId: changeSet.runId ?? null,
        toolCallId: changeSet.toolCallId ?? null,
        toolExecutionId: changeSet.toolExecutionId ?? null,
        status: changeSet.status,
        changedFileCount: changeSet.changes.length,
        createdAt: changeSet.createdAt,
        updatedAt: changeSet.updatedAt,
        finalizedAt: changeSet.finalizedAt ?? null,
        changeSetJson: JSON.stringify({ ...changeSet, changes: [] }),
      });

      for (const change of changeSet.changes) {
        this.saveChangedFileSync(change, changeSet);
      }
    });
  }

  async getChangeSet(id: string): Promise<WorkspaceChangeSet | undefined> {
    const row = this.database
      .prepare('SELECT id, change_set_json AS value_json FROM workspace_change_sets WHERE id = ?')
      .get(id) as JsonRow | undefined;
    if (!row) return undefined;
    return { ...mapJson<WorkspaceChangeSet>(row, 'workspace_change_sets'), changes: await this.listChangedFiles(id) };
  }

  async listChangeSets(input: { workspaceId?: string; runId?: string; sessionId?: string }): Promise<WorkspaceChangeSet[]> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (input.workspaceId) {
      clauses.push('workspace_id = @workspaceId');
      params.workspaceId = input.workspaceId;
    }
    if (input.runId) {
      clauses.push('run_id = @runId');
      params.runId = input.runId;
    }
    if (input.sessionId) {
      clauses.push('session_id = @sessionId');
      params.sessionId = input.sessionId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database
      .prepare(`SELECT id, change_set_json AS value_json FROM workspace_change_sets ${where} ORDER BY created_at ASC`)
      .all(params) as JsonRow[];
    return Promise.all(rows.map(async (row) => ({
      ...mapJson<WorkspaceChangeSet>(row, 'workspace_change_sets'),
      changes: await this.listChangedFiles(row.id),
    })));
  }

  async saveChangedFile(changedFile: WorkspaceChangedFile): Promise<void> {
    this.saveChangedFileSync(changedFile);
  }

  async listChangedFiles(changeSetId: string): Promise<WorkspaceChangedFile[]> {
    return (this.database
      .prepare('SELECT id, changed_file_json AS value_json FROM workspace_changed_files WHERE change_set_id = ? ORDER BY created_at ASC')
      .all(changeSetId) as JsonRow[]).map((row) => mapJson<WorkspaceChangedFile>(row, 'workspace_changed_files'));
  }

  async saveCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
    this.database.prepare(`
      INSERT INTO workspace_checkpoints (
        id, workspace_id, run_id, change_set_id, status, label, created_at, updated_at, checkpoint_json
      ) VALUES (
        @id, @workspaceId, @runId, @changeSetId, @status, @label, @createdAt, @updatedAt, @checkpointJson
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at,
        checkpoint_json = excluded.checkpoint_json
    `).run({
      id: String(checkpoint.id),
      workspaceId: String(checkpoint.workspaceId),
      runId: checkpoint.runId ?? null,
      changeSetId: checkpoint.changeSetId ? String(checkpoint.changeSetId) : null,
      status: checkpoint.status,
      label: checkpoint.label,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt,
      checkpointJson: JSON.stringify(checkpoint),
    });
  }

  async getCheckpoint(id: string): Promise<WorkspaceCheckpoint | undefined> {
    const row = this.database
      .prepare('SELECT id, checkpoint_json AS value_json FROM workspace_checkpoints WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? mapJson<WorkspaceCheckpoint>(row, 'workspace_checkpoints') : undefined;
  }

  async saveRestoreRequest(request: WorkspaceRestoreRequest): Promise<void> {
    this.database.prepare(`
      INSERT INTO workspace_restore_requests (
        id, workspace_id, checkpoint_id, change_set_id, requested_by, status, created_at, request_json
      ) VALUES (
        @id, @workspaceId, @checkpointId, @changeSetId, @requestedBy, @status, @createdAt, @requestJson
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        request_json = excluded.request_json
    `).run({
      id: String(request.id),
      workspaceId: String(request.workspaceId),
      checkpointId: String(request.checkpointId),
      changeSetId: request.changeSetId ? String(request.changeSetId) : null,
      requestedBy: request.requestedBy,
      status: request.status,
      createdAt: request.createdAt,
      requestJson: JSON.stringify(request),
    });
  }

  async getRestoreRequest(id: string): Promise<WorkspaceRestoreRequest | undefined> {
    const row = this.database
      .prepare('SELECT id, request_json AS value_json FROM workspace_restore_requests WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? mapJson<WorkspaceRestoreRequest>(row, 'workspace_restore_requests') : undefined;
  }

  async saveRestoreResult(result: WorkspaceRestoreResult): Promise<void> {
    runInTransaction(this.database, () => {
      this.database.prepare(`
        INSERT INTO workspace_restore_results (
          id, request_id, checkpoint_id, workspace_id, status, restored_count, failed_count, completed_at, result_json
        ) VALUES (
          @id, @requestId, @checkpointId, @workspaceId, @status, @restoredCount, @failedCount, @completedAt, @resultJson
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          restored_count = excluded.restored_count,
          failed_count = excluded.failed_count,
          completed_at = excluded.completed_at,
          result_json = excluded.result_json
      `).run({
        id: String(result.id),
        requestId: String(result.requestId),
        checkpointId: String(result.checkpointId),
        workspaceId: String(result.workspaceId),
        status: result.status,
        restoredCount: result.restoredCount,
        failedCount: result.failedCount,
        completedAt: result.completedAt,
        resultJson: JSON.stringify(result),
      });
      this.updateRestoreStatesForResult(result);
    });
  }

  async getRestoreResult(id: string): Promise<WorkspaceRestoreResult | undefined> {
    const row = this.database
      .prepare('SELECT id, result_json AS value_json FROM workspace_restore_results WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? mapJson<WorkspaceRestoreResult>(row, 'workspace_restore_results') : undefined;
  }

  private saveChangedFileSync(changedFile: WorkspaceChangedFile, changeSet?: WorkspaceChangeSet): void {
    this.database.prepare(`
      INSERT INTO workspace_changed_files (
        id, change_set_id, workspace_id, run_id, tool_call_id, tool_execution_id,
        path, operation, restore_state, created_at, changed_file_json
      ) VALUES (
        @id, @changeSetId, @workspaceId, @runId, @toolCallId, @toolExecutionId,
        @path, @operation, @restoreState, @createdAt, @changedFileJson
      )
      ON CONFLICT(id) DO UPDATE SET
        restore_state = excluded.restore_state,
        changed_file_json = excluded.changed_file_json
    `).run({
      id: String(changedFile.id),
      changeSetId: String(changedFile.changeSetId),
      workspaceId: changeSet ? String(changeSet.workspaceId) : null,
      runId: changeSet?.runId ?? null,
      toolCallId: changeSet?.toolCallId ?? null,
      toolExecutionId: changeSet?.toolExecutionId ?? null,
      path: String(changedFile.path),
      operation: changedFile.operation,
      restoreState: changedFile.restoreState,
      createdAt: changedFile.createdAt,
      changedFileJson: JSON.stringify(changedFile),
    });
  }

  private updateRestoreStatesForResult(result: WorkspaceRestoreResult): void {
    const request = this.database
      .prepare('SELECT id, request_json AS value_json FROM workspace_restore_requests WHERE id = ?')
      .get(String(result.requestId)) as JsonRow | undefined;
    const changeSetId = request ? mapJson<WorkspaceRestoreRequest>(request, 'workspace_restore_requests').changeSetId : undefined;
    if (!changeSetId) return;
    for (const fileResult of result.fileResults) {
      const restoreState = fileResult.status === 'restored' || fileResult.status === 'removed'
        ? 'restored'
        : fileResult.status === 'conflict'
          ? 'conflicted'
          : undefined;
      if (!restoreState) continue;
      const rows = this.database
        .prepare('SELECT id, changed_file_json AS value_json FROM workspace_changed_files WHERE change_set_id = ? AND path = ?')
        .all(String(changeSetId), String(fileResult.path)) as JsonRow[];
      for (const row of rows) {
        const changedFile = mapJson<WorkspaceChangedFile>(row, 'workspace_changed_files');
        const updated = { ...changedFile, restoreState };
        this.database.prepare(`
          UPDATE workspace_changed_files
          SET restore_state = @restoreState, changed_file_json = @changedFileJson
          WHERE id = @id
        `).run({ id: row.id, restoreState, changedFileJson: JSON.stringify(updated) });
      }
    }
  }
}

function mapJson<T>(row: JsonRow, table: string): T {
  return decodeJsonField<T>({
    value: row.value_json,
    table,
    column: 'json',
    rowId: row.id,
  }) as T;
}
