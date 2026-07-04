/*
 * Transitional read/write access for workspace change facts while composition
 * is moved to the Workspace-owned repository. This file only targets
 * workspace_changes and workspace_changed_files.
 */
import type { MegumiDatabase } from '../connection';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '../../workspace/contracts/workspace-change-contracts';

interface ChangeSetRow {
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSet['status'];
  changed_file_count: number;
  created_at: string;
  finalized_at: string | null;
}

interface ChangedFileRow {
  changed_file_id: string;
  change_set_id: string;
  workspace_path: string;
  change_kind: WorkspaceChangedFile['change_kind'];
  created_at: string;
}

export class WorkspaceChangeRepository {
  constructor(private readonly database: MegumiDatabase) {}

  insertChangeSet(changeSet: WorkspaceChangeSet): WorkspaceChangeSet {
    this.database.prepare(`
      INSERT INTO workspace_changes (
        change_set_id, workspace_id, session_id, run_id, status,
        changed_file_count, created_at, finalized_at
      ) VALUES (
        @change_set_id, @workspace_id, @session_id, @run_id, @status,
        @changed_file_count, @created_at, @finalized_at
      )
      ON CONFLICT(change_set_id) DO UPDATE SET
        status = excluded.status,
        changed_file_count = excluded.changed_file_count,
        finalized_at = excluded.finalized_at
    `).run(toChangeSetRow(changeSet));
    return this.findChangeSetById(changeSet.change_set_id) ?? changeSet;
  }

  findChangeSetById(changeSetId: string): WorkspaceChangeSet | undefined {
    const row = this.database.prepare('SELECT * FROM workspace_changes WHERE change_set_id = ?')
      .get(changeSetId) as ChangeSetRow | undefined;
    return row ? fromChangeSetRow(row) : undefined;
  }

  findOpenChangeSet(input: { workspace_id: string; session_id: string; run_id: string }): WorkspaceChangeSet | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_changes
      WHERE workspace_id = @workspace_id
        AND session_id = @session_id
        AND run_id = @run_id
        AND status = 'open'
      ORDER BY created_at ASC, change_set_id ASC
      LIMIT 1
    `).get(input) as ChangeSetRow | undefined;
    return row ? fromChangeSetRow(row) : undefined;
  }

  listChangeSetsByRunId(runId: string): WorkspaceChangeSet[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_changes
      WHERE run_id = ?
      ORDER BY created_at ASC, change_set_id ASC
    `).all(runId) as ChangeSetRow[]).map(fromChangeSetRow);
  }

  finalizeChangeSet(input: { change_set_id: string; finalized_at: string }): WorkspaceChangeSet | undefined {
    const existing = this.findChangeSetById(input.change_set_id);
    if (!existing || existing.status === 'finalized') {
      return existing;
    }
    this.database.prepare(`
      UPDATE workspace_changes
      SET status = 'finalized',
          changed_file_count = @changed_file_count,
          finalized_at = @finalized_at
      WHERE change_set_id = @change_set_id
    `).run({
      change_set_id: input.change_set_id,
      finalized_at: input.finalized_at,
      changed_file_count: this.countChangedFiles(input.change_set_id),
    });
    return this.findChangeSetById(input.change_set_id);
  }

  insertOrUpdateChangedFile(file: WorkspaceChangedFile): WorkspaceChangedFile {
    const existing = this.findChangedFileByChangeSetPath(file.change_set_id, file.workspace_path);
    const row = toChangedFileRow(existing ? {
      ...file,
      changed_file_id: existing.changed_file_id,
      created_at: existing.created_at,
    } : file);
    this.database.prepare(`
      INSERT INTO workspace_changed_files (
        changed_file_id, change_set_id, workspace_path, change_kind, created_at
      ) VALUES (
        @changed_file_id, @change_set_id, @workspace_path, @change_kind, @created_at
      )
      ON CONFLICT(change_set_id, workspace_path) DO UPDATE SET
        change_kind = excluded.change_kind
    `).run(row);
    this.updateChangedFileCount(file.change_set_id);
    return this.findChangedFileByChangeSetPath(file.change_set_id, file.workspace_path) ?? file;
  }

  listChangedFilesByChangeSetId(changeSetId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_changed_files
      WHERE change_set_id = ?
      ORDER BY created_at ASC, changed_file_id ASC
    `).all(changeSetId) as ChangedFileRow[]).map(fromChangedFileRow);
  }

  listChangedFilesByRunId(runId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT f.*
      FROM workspace_changed_files f
      INNER JOIN workspace_changes c ON c.change_set_id = f.change_set_id
      WHERE c.run_id = ?
      ORDER BY f.created_at ASC, f.changed_file_id ASC
    `).all(runId) as ChangedFileRow[]).map(fromChangedFileRow);
  }

  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined {
    const changeSet = this.findChangeSetById(changeSetId);
    if (!changeSet) {
      return undefined;
    }
    return {
      change_set: changeSet,
      files: this.listChangedFilesByChangeSetId(changeSetId),
    };
  }

  listChangedFilesByRun(runId: string): WorkspaceChangedFile[] {
    return this.listChangedFilesByRunId(runId);
  }

  private findChangedFileByChangeSetPath(changeSetId: string, workspacePath: string): WorkspaceChangedFile | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_changed_files
      WHERE change_set_id = ?
        AND workspace_path = ?
    `).get(changeSetId, workspacePath) as ChangedFileRow | undefined;
    return row ? fromChangedFileRow(row) : undefined;
  }

  private countChangedFiles(changeSetId: string): number {
    const row = this.database.prepare('SELECT COUNT(*) AS count FROM workspace_changed_files WHERE change_set_id = ?')
      .get(changeSetId) as { count: number };
    return row.count;
  }

  private updateChangedFileCount(changeSetId: string): void {
    this.database.prepare(`
      UPDATE workspace_changes
      SET changed_file_count = ?
      WHERE change_set_id = ?
    `).run(this.countChangedFiles(changeSetId), changeSetId);
  }
}

function toChangeSetRow(changeSet: WorkspaceChangeSet): ChangeSetRow {
  return {
    change_set_id: changeSet.change_set_id,
    workspace_id: changeSet.workspace_id,
    session_id: changeSet.session_id,
    run_id: changeSet.run_id,
    status: changeSet.status,
    changed_file_count: changeSet.changed_file_count,
    created_at: changeSet.created_at,
    finalized_at: changeSet.finalized_at ?? null,
  };
}

function fromChangeSetRow(row: ChangeSetRow): WorkspaceChangeSet {
  return {
    change_set_id: row.change_set_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.run_id,
    status: row.status,
    changed_file_count: row.changed_file_count,
    created_at: row.created_at,
    ...(row.finalized_at ? { finalized_at: row.finalized_at } : {}),
  };
}

function toChangedFileRow(file: WorkspaceChangedFile): ChangedFileRow {
  return {
    changed_file_id: file.changed_file_id,
    change_set_id: file.change_set_id,
    workspace_path: file.workspace_path,
    change_kind: file.change_kind,
    created_at: file.created_at,
  };
}

function fromChangedFileRow(row: ChangedFileRow): WorkspaceChangedFile {
  return {
    changed_file_id: row.changed_file_id,
    change_set_id: row.change_set_id,
    workspace_path: row.workspace_path,
    change_kind: row.change_kind,
    created_at: row.created_at,
  };
}
