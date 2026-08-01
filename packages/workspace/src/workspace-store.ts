/*
 * Defines and implements Database access for Workspace-owned tables only.
 */
import type {
  DatabaseConnection,
  DatabaseValue,
} from '@megumi/database';
import type { Workspace } from './workspace';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from './workspace-changes';

export interface WorkspaceStore {
  upsertWorkspace(workspace: Workspace): Workspace;
  findWorkspaceById(workspaceId: string): Workspace | undefined;
  findWorkspaceByRootPathKey(rootPathKey: string): Workspace | undefined;
  listWorkspaces(): Workspace[];
  updateWorkspaceStatus(input: {
    workspace_id: string;
    status: Workspace['status'];
    updated_at: string;
  }): Workspace | undefined;
  deleteWorkspace(workspaceId: string): 'deleted' | 'not_found' | 'blocked';
  insertChangeSet(changeSet: WorkspaceChangeSet): WorkspaceChangeSet;
  findChangeSetById(changeSetId: string): WorkspaceChangeSet | undefined;
  findOpenChangeSet(input: {
    workspace_id: string;
    session_id: string;
    run_id: string;
  }): WorkspaceChangeSet | undefined;
  listChangeSetsByRunId(runId: string): WorkspaceChangeSet[];
  finalizeChangeSet(input: {
    change_set_id: string;
    finalized_at: string;
  }): WorkspaceChangeSet | undefined;
  upsertChangedFile(file: WorkspaceChangedFile): WorkspaceChangedFile;
  listChangedFilesByChangeSetId(changeSetId: string): WorkspaceChangedFile[];
  listChangedFilesByRunId(runId: string): WorkspaceChangedFile[];
  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined;
}

export interface CreateWorkspaceStoreRequest {
  database: DatabaseConnection;
}

interface WorkspaceRow {
  readonly [column: string]: DatabaseValue;
  workspace_id: string;
  name: string;
  root_path: string;
  root_path_key: string;
  status: Workspace['status'];
  created_at: string;
  updated_at: string;
  last_opened_at: string;
}

interface ChangeSetRow {
  readonly [column: string]: DatabaseValue;
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSet['status'];
  effect_coverage: WorkspaceChangeSet['effect_coverage'];
  changed_file_count: number;
  created_at: string;
  finalized_at: string | null;
}

interface ChangedFileRow {
  readonly [column: string]: DatabaseValue;
  changed_file_id: string;
  change_set_id: string;
  workspace_path: string;
  change_kind: WorkspaceChangedFile['change_kind'];
  effect_type: WorkspaceChangedFile['effect_type'];
  source_workspace_path: string | null;
  destination_workspace_path: string | null;
  path_type: WorkspaceChangedFile['path_type'];
  recoverable: number | null;
  created_at: string;
}

interface CountRow {
  readonly [column: string]: DatabaseValue;
  count: number;
}

export function createWorkspaceStore(request: CreateWorkspaceStoreRequest): WorkspaceStore {
  const database = request.database;

  const store: WorkspaceStore = {
    upsertWorkspace(workspace) {
      database.prepare({ sql: `
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
      ` }).run(toWorkspaceRow(workspace));
      return store.findWorkspaceByRootPathKey(workspace.root_path_key) ?? workspace;
    },

    findWorkspaceById(workspaceId) {
      const row = database.prepare<WorkspaceRow>({
        sql: 'SELECT * FROM workspaces WHERE workspace_id = ?',
      }).get([workspaceId]);
      return row ? fromWorkspaceRow(row) : undefined;
    },

    findWorkspaceByRootPathKey(rootPathKey) {
      const row = database.prepare<WorkspaceRow>({
        sql: 'SELECT * FROM workspaces WHERE root_path_key = ?',
      }).get([rootPathKey]);
      return row ? fromWorkspaceRow(row) : undefined;
    },

    listWorkspaces() {
      return database.prepare<WorkspaceRow>({ sql: `
        SELECT * FROM workspaces
        ORDER BY last_opened_at DESC, name ASC
      ` }).all().map(fromWorkspaceRow);
    },

    updateWorkspaceStatus(input) {
      database.prepare({ sql: `
        UPDATE workspaces
        SET status = @status, updated_at = @updated_at
        WHERE workspace_id = @workspace_id
      ` }).run(input);
      return store.findWorkspaceById(input.workspace_id);
    },

    deleteWorkspace(workspaceId) {
      if (!store.findWorkspaceById(workspaceId)) return 'not_found';
      const ownedFacts = database.prepare<CountRow>({
        sql: 'SELECT COUNT(*) AS count FROM workspace_changes WHERE workspace_id = ?',
      }).get([workspaceId]);
      if (Number(ownedFacts?.count ?? 0) > 0) return 'blocked';
      try {
        const result = database.prepare({ sql: 'DELETE FROM workspaces WHERE workspace_id = ?' })
          .run([workspaceId]);
        return result.changes > 0 ? 'deleted' : 'not_found';
      } catch {
        // Foreign-key constraints from another Owner are a collaboration fact,
        // not authority for Workspace to query or delete that Owner's rows.
        return 'blocked';
      }
    },

    insertChangeSet(changeSet) {
      database.prepare({ sql: `
        INSERT INTO workspace_changes (
          change_set_id, workspace_id, session_id, run_id, status, effect_coverage,
          changed_file_count, created_at, finalized_at
        ) VALUES (
          @change_set_id, @workspace_id, @session_id, @run_id, @status, @effect_coverage,
          @changed_file_count, @created_at, @finalized_at
        )
        ON CONFLICT(change_set_id) DO UPDATE SET
          status = excluded.status,
          effect_coverage = excluded.effect_coverage,
          changed_file_count = excluded.changed_file_count,
          finalized_at = excluded.finalized_at
      ` }).run(toChangeSetRow(changeSet));
      return store.findChangeSetById(changeSet.change_set_id) ?? changeSet;
    },

    findChangeSetById(changeSetId) {
      const row = database.prepare<ChangeSetRow>({
        sql: 'SELECT * FROM workspace_changes WHERE change_set_id = ?',
      }).get([changeSetId]);
      return row ? fromChangeSetRow(row) : undefined;
    },

    findOpenChangeSet(input) {
      const row = database.prepare<ChangeSetRow>({ sql: `
        SELECT * FROM workspace_changes
        WHERE workspace_id = @workspace_id
          AND session_id = @session_id
          AND run_id = @run_id
          AND status = 'open'
        ORDER BY created_at ASC, change_set_id ASC
        LIMIT 1
      ` }).get(input);
      return row ? fromChangeSetRow(row) : undefined;
    },

    listChangeSetsByRunId(runId) {
      return database.prepare<ChangeSetRow>({ sql: `
        SELECT * FROM workspace_changes
        WHERE run_id = ?
        ORDER BY created_at ASC, change_set_id ASC
      ` }).all([runId]).map(fromChangeSetRow);
    },

    finalizeChangeSet(input) {
      return database.transaction({ operation: () => {
        const existing = store.findChangeSetById(input.change_set_id);
        if (!existing || existing.status === 'finalized') return existing;
        database.prepare({ sql: `
          UPDATE workspace_changes
          SET status = 'finalized',
              changed_file_count = @changed_file_count,
              finalized_at = @finalized_at
          WHERE change_set_id = @change_set_id
        ` }).run({
          ...input,
          changed_file_count: countChangedFiles(database, input.change_set_id),
        });
        return store.findChangeSetById(input.change_set_id);
      } });
    },

    upsertChangedFile(file) {
      return database.transaction({ operation: () => {
        const existing = findChangedFile(database, file.change_set_id, file.workspace_path);
        const persisted = existing
          ? { ...file, changed_file_id: existing.changed_file_id, created_at: existing.created_at }
          : file;
        database.prepare({ sql: `
          INSERT INTO workspace_changed_files (
            changed_file_id, change_set_id, workspace_path, change_kind, effect_type,
            source_workspace_path, destination_workspace_path, path_type, recoverable, created_at
          ) VALUES (
            @changed_file_id, @change_set_id, @workspace_path, @change_kind, @effect_type,
            @source_workspace_path, @destination_workspace_path, @path_type, @recoverable, @created_at
          )
          ON CONFLICT(change_set_id, workspace_path) DO UPDATE SET
            change_kind = excluded.change_kind,
            effect_type = excluded.effect_type,
            source_workspace_path = excluded.source_workspace_path,
            destination_workspace_path = excluded.destination_workspace_path,
            path_type = excluded.path_type,
            recoverable = excluded.recoverable
        ` }).run(toChangedFileRow(persisted));
        database.prepare({ sql: `
          UPDATE workspace_changes
          SET changed_file_count = ?
          WHERE change_set_id = ?
        ` }).run([countChangedFiles(database, file.change_set_id), file.change_set_id]);
        return findChangedFile(database, file.change_set_id, file.workspace_path) ?? persisted;
      } });
    },

    listChangedFilesByChangeSetId(changeSetId) {
      return database.prepare<ChangedFileRow>({ sql: `
        SELECT * FROM workspace_changed_files
        WHERE change_set_id = ?
        ORDER BY created_at ASC, changed_file_id ASC
      ` }).all([changeSetId]).map(fromChangedFileRow);
    },

    listChangedFilesByRunId(runId) {
      return database.prepare<ChangedFileRow>({ sql: `
        SELECT f.*
        FROM workspace_changed_files f
        INNER JOIN workspace_changes c ON c.change_set_id = f.change_set_id
        WHERE c.run_id = ?
        ORDER BY f.created_at ASC, f.changed_file_id ASC
      ` }).all([runId]).map(fromChangedFileRow);
    },

    getChangeSummary(changeSetId) {
      const change_set = store.findChangeSetById(changeSetId);
      return change_set
        ? { change_set, files: store.listChangedFilesByChangeSetId(changeSetId) }
        : undefined;
    },
  };

  return store;
}

function findChangedFile(
  database: DatabaseConnection,
  changeSetId: string,
  workspacePath: string,
): WorkspaceChangedFile | undefined {
  const row = database.prepare<ChangedFileRow>({ sql: `
    SELECT * FROM workspace_changed_files
    WHERE change_set_id = ? AND workspace_path = ?
  ` }).get([changeSetId, workspacePath]);
  return row ? fromChangedFileRow(row) : undefined;
}

function countChangedFiles(database: DatabaseConnection, changeSetId: string): number {
  return Number(database.prepare<CountRow>({ sql: `
    SELECT COUNT(*) AS count FROM workspace_changed_files
    WHERE change_set_id = ?
  ` }).get([changeSetId])?.count ?? 0);
}

function toWorkspaceRow(workspace: Workspace): WorkspaceRow { return { ...workspace }; }
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
function toChangeSetRow(changeSet: WorkspaceChangeSet): ChangeSetRow {
  return { ...changeSet, finalized_at: changeSet.finalized_at ?? null };
}
function fromChangeSetRow(row: ChangeSetRow): WorkspaceChangeSet {
  return {
    change_set_id: row.change_set_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    run_id: row.run_id,
    status: row.status,
    effect_coverage: row.effect_coverage,
    changed_file_count: row.changed_file_count,
    created_at: row.created_at,
    ...(row.finalized_at ? { finalized_at: row.finalized_at } : {}),
  };
}
function toChangedFileRow(file: WorkspaceChangedFile): ChangedFileRow {
  return {
    ...file,
    source_workspace_path: file.source_workspace_path ?? null,
    destination_workspace_path: file.destination_workspace_path ?? null,
    recoverable: file.recoverable === undefined ? null : file.recoverable ? 1 : 0,
  };
}
function fromChangedFileRow(row: ChangedFileRow): WorkspaceChangedFile {
  return {
    changed_file_id: row.changed_file_id,
    change_set_id: row.change_set_id,
    workspace_path: row.workspace_path,
    change_kind: row.change_kind,
    effect_type: row.effect_type,
    ...(row.source_workspace_path ? { source_workspace_path: row.source_workspace_path } : {}),
    ...(row.destination_workspace_path ? { destination_workspace_path: row.destination_workspace_path } : {}),
    path_type: row.path_type,
    ...(row.recoverable === null ? {} : { recoverable: row.recoverable === 1 }),
    created_at: row.created_at,
  };
}
