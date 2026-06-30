// Persists workspace file-change tracking through the redesigned workspace tables.
import { createHash } from 'node:crypto';

import {
  WorkspaceChangedFileSchema,
  WorkspaceChangeSetSchema,
  WorkspaceChangeSummarySchema,
  WorkspaceRestoreFileResultSchema,
  WorkspaceRestoreRequestSchema,
  WorkspaceRestoreResultSchema,
  WorkspaceSnapshotContentSchema,
  type WorkspaceChangedFile,
  type WorkspaceChangeSet,
  type WorkspaceChangeSummary,
  type WorkspaceRestoreFileResult,
  type WorkspaceRestoreRequest,
  type WorkspaceRestoreResult,
  type WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';

import type { MegumiDatabase } from '../connection';

interface SnapshotRow {
  snapshot_id: string;
  session_id: string;
  run_id: string;
  path: string;
  storage: WorkspaceSnapshotContent['storage'];
  encoding: WorkspaceSnapshotContent['encoding'];
  sha256: string;
  byte_length: number;
  content_text: string | null;
  created_at: string;
  metadata_json: string | null;
}

interface ChangeRow {
  change_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSet['status'];
  changed_file_count: number;
  created_at: string;
  finalized_at: string | null;
  metadata_json: string | null;
}

interface ChangedFileRow {
  changed_file_id: string;
  change_id: string;
  session_id: string;
  run_id: string;
  path: string;
  change_kind: WorkspaceChangedFile['changeKind'];
  restore_state: WorkspaceChangedFile['restoreState'];
  before_exists: 0 | 1;
  before_snapshot_id: string | null;
  before_hash: string | null;
  after_exists: 0 | 1;
  after_snapshot_id: string | null;
  after_hash: string | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

interface RestoreOperationRow {
  restore_id: string;
  change_id: string;
  requested_by: WorkspaceRestoreRequest['requestedBy'];
  status: WorkspaceRestoreRequest['status'];
  requested_at: string;
  completed_at: string | null;
  result_json: string | null;
  error_json: string | null;
  metadata_json: string | null;
}

interface RestoreFileResultRow {
  file_result_id: string;
  restore_id: string;
  changed_file_id: string;
  path: string;
  status: WorkspaceRestoreFileResult['status'];
  conflict_reason: WorkspaceRestoreFileResult['conflictReason'] | null;
  error_json: string | null;
  restored_at: string | null;
  metadata_json: string | null;
}

interface SummaryRow {
  changed_file_count: number;
  restorable_count: number;
  restored_count: number;
  conflict_count: number;
  failed_count: number;
  updated_at: string | null;
}

interface RunContextRow {
  session_id: string;
  workspace_id: string;
}

interface ChangeMetadata {
  userMetadata?: WorkspaceChangeSet['metadata'];
  stepId?: string;
  sourceEntryId?: string;
  responseMessageId?: string;
}

interface ChangedFileMetadata {
  userMetadata?: WorkspaceChangedFile['metadata'];
  workspaceCheckpointId: string;
  stepId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
  sourceEntryId?: string;
  responseMessageId?: string;
  beforeByteLength?: number;
  afterByteLength?: number;
}

interface SnapshotMetadata {
  userMetadata?: WorkspaceSnapshotContent['metadata'];
}

interface RestoreOperationMetadata {
  userMetadata?: WorkspaceRestoreRequest['metadata'];
  resultMetadata?: WorkspaceRestoreResult['metadata'];
}

interface RestoreFileResultMetadata {
  userMetadata?: WorkspaceRestoreFileResult['metadata'];
  restoreResultId: string;
}

export class WorkspaceChangeRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveFileSnapshot(content: WorkspaceSnapshotContent): WorkspaceSnapshotContent {
    const parsed = WorkspaceSnapshotContentSchema.parse(content);
    assertSnapshotContentMatchesDeclaredIntegrity(parsed);
    const context = getRunContext(this.database, 'Snapshot content', parsed.sessionId, parsed.runId);
    const existing = this.getSnapshotContent(parsed.contentRefId);
    if (existing) {
      assertSnapshotDurableFieldsMatch(existing, parsed);
      this.database.prepare('UPDATE workspace_file_snapshots SET metadata_json = ? WHERE snapshot_id = ?')
        .run(stringifyJson({ userMetadata: parsed.metadata } satisfies SnapshotMetadata), parsed.contentRefId);
      return parsed;
    }

    this.database.prepare(`
      INSERT INTO workspace_file_snapshots (
        snapshot_id, workspace_id, run_id, path, storage, encoding, sha256,
        byte_length, content_text, content_ref, created_at, metadata_json
      ) VALUES (
        @snapshot_id, @workspace_id, @run_id, @path, @storage, @encoding, @sha256,
        @byte_length, @content_text, NULL, @created_at, @metadata_json
      )
    `).run({
      snapshot_id: parsed.contentRefId,
      workspace_id: context.workspace_id,
      run_id: parsed.runId,
      path: parsed.projectPath,
      storage: parsed.storage,
      encoding: parsed.encoding,
      sha256: parsed.sha256,
      byte_length: parsed.byteLength,
      content_text: parsed.contentText,
      created_at: parsed.createdAt,
      metadata_json: stringifyJson({ userMetadata: parsed.metadata } satisfies SnapshotMetadata),
    });
    return parsed;
  }

  getSnapshotContent(contentRefId: string): WorkspaceSnapshotContent | undefined {
    const row = this.database.prepare(`
      SELECT s.*, r.session_id
      FROM workspace_file_snapshots s
      LEFT JOIN agent_loop_runs r ON r.run_id = s.run_id
      WHERE s.snapshot_id = ?
    `).get(contentRefId) as SnapshotRow | undefined;
    if (row && (!row.session_id || !row.run_id)) {
      return undefined;
    }
    return row ? snapshotFromRow(row) : undefined;
  }

  recordWorkspaceChange(changeSet: WorkspaceChangeSet): WorkspaceChangeSet {
    const parsed = WorkspaceChangeSetSchema.parse(changeSet);
    const existing = this.getWorkspaceChange(parsed.changeSetId);
    if (existing) {
      assertDurableRecordMatches('Workspace change set', parsed.changeSetId, existing, parsed);
      return parsed;
    }
    if (parsed.status !== 'open' || parsed.finalizedAt !== undefined) {
      throw new Error(`Workspace change ${parsed.changeSetId} cannot be finalized through recordWorkspaceChange`);
    }
    if (parsed.changedFileCount !== 0) {
      throw new Error(`Workspace change ${parsed.changeSetId} changedFileCount cannot be set through recordWorkspaceChange`);
    }
    const context = getRunContext(this.database, 'Workspace change set', parsed.sessionId, parsed.runId);

    this.database.prepare(`
      INSERT INTO workspace_changes (
        change_id, workspace_id, session_id, run_id, status, changed_file_count,
        created_at, finalized_at, metadata_json
      ) VALUES (
        @change_id, @workspace_id, @session_id, @run_id, @status, @changed_file_count,
        @created_at, NULL, @metadata_json
      )
    `).run({
      change_id: parsed.changeSetId,
      workspace_id: context.workspace_id,
      session_id: parsed.sessionId,
      run_id: parsed.runId,
      status: parsed.status,
      changed_file_count: parsed.changedFileCount,
      created_at: parsed.createdAt,
      metadata_json: stringifyJson(changeMetadataFromChangeSet(parsed)),
    });
    return parsed;
  }

  getWorkspaceChange(changeSetId: string): WorkspaceChangeSet | undefined {
    const row = this.database.prepare('SELECT * FROM workspace_changes WHERE change_id = ?')
      .get(changeSetId) as ChangeRow | undefined;
    return row ? changeSetFromRow(row) : undefined;
  }

  listWorkspaceChangesByRun(runId: string): WorkspaceChangeSet[] {
    return (this.database.prepare(`
      SELECT * FROM workspace_changes
      WHERE run_id = ?
      ORDER BY created_at ASC, change_id ASC
    `).all(runId) as ChangeRow[]).map(changeSetFromRow);
  }

  finalizeWorkspaceChange(changeSetId: string, finalizedAt: string): WorkspaceChangeSet | undefined {
    const existing = this.getWorkspaceChange(changeSetId);
    if (!existing) {
      return undefined;
    }
    const changedFileCount = countChangedFiles(this.database, changeSetId);
    if (existing.status === 'finalized') {
      if (existing.finalizedAt === finalizedAt && existing.changedFileCount === changedFileCount) {
        return existing;
      }
      throw new Error(`Workspace change set ${changeSetId} is already finalized and cannot be finalized again with different state`);
    }

    this.database.prepare(`
      UPDATE workspace_changes
      SET status = 'finalized', changed_file_count = ?, finalized_at = ?
      WHERE change_id = ?
    `).run(changedFileCount, finalizedAt, changeSetId);
    return this.getWorkspaceChange(changeSetId);
  }

  recordChangedFile(changedFile: WorkspaceChangedFile): WorkspaceChangedFile {
    const parsed = WorkspaceChangedFileSchema.parse(changedFile);
    const existing = this.getChangedFile(parsed.changedFileId);
    if (existing) {
      assertDurableRecordMatches('Changed file', parsed.changedFileId, existing, parsed);
      return parsed;
    }

    const changeSet = this.getWorkspaceChange(parsed.changeSetId);
    if (!changeSet) {
      throw new Error(`Cannot save changed file without change set: ${parsed.changeSetId}`);
    }
    if (changeSet.status === 'finalized') {
      throw new Error(`Cannot save changed file ${parsed.changedFileId} into finalized change set ${parsed.changeSetId}`);
    }
    assertSameSessionRun({
      subject: 'Changed file',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'change set',
      referenceSessionId: changeSet.sessionId,
      referenceRunId: changeSet.runId,
    });
    getRunContext(this.database, 'Changed file', parsed.sessionId, parsed.runId);
    validateToolCallRef(this.database, 'Changed file', parsed.toolCallId, parsed.runId);
    validateSnapshotOwner(this.database, 'Changed file', 'beforeContentRefId', parsed.beforeContentRefId, parsed);
    validateSnapshotOwner(this.database, 'Changed file', 'afterContentRefId', parsed.afterContentRefId, parsed);

    this.database.prepare(`
      INSERT INTO workspace_changed_files (
        changed_file_id, change_id, path, change_kind, restore_state,
        before_exists, before_snapshot_id, before_hash, after_exists, after_snapshot_id,
        after_hash, created_at, updated_at, metadata_json
      ) VALUES (
        @changed_file_id, @change_id, @path, @change_kind, @restore_state,
        @before_exists, @before_snapshot_id, @before_hash, @after_exists, @after_snapshot_id,
        @after_hash, @created_at, @updated_at, @metadata_json
      )
    `).run({
      changed_file_id: parsed.changedFileId,
      change_id: parsed.changeSetId,
      path: parsed.projectPath,
      change_kind: parsed.changeKind,
      restore_state: parsed.restoreState,
      before_exists: parsed.beforeExists ? 1 : 0,
      before_snapshot_id: parsed.beforeContentRefId ?? null,
      before_hash: parsed.beforeHash ?? null,
      after_exists: parsed.afterExists ? 1 : 0,
      after_snapshot_id: parsed.afterContentRefId ?? null,
      after_hash: parsed.afterHash ?? null,
      created_at: parsed.createdAt,
      updated_at: parsed.updatedAt,
      metadata_json: stringifyJson(changedFileMetadataFrom(parsed)),
    });
    updateChangeFileCount(this.database, parsed.changeSetId);
    return parsed;
  }

  getChangedFile(changedFileId: string): WorkspaceChangedFile | undefined {
    const row = this.database.prepare(`
      SELECT f.*, c.session_id, c.run_id
      FROM workspace_changed_files f
      INNER JOIN workspace_changes c ON c.change_id = f.change_id
      WHERE f.changed_file_id = ?
    `).get(changedFileId) as ChangedFileRow | undefined;
    return row ? changedFileFromRow(row) : undefined;
  }

  listChangedFilesByChangeSet(changeSetId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT f.*, c.session_id, c.run_id
      FROM workspace_changed_files f
      INNER JOIN workspace_changes c ON c.change_id = f.change_id
      WHERE f.change_id = ?
      ORDER BY f.created_at ASC, f.changed_file_id ASC
    `).all(changeSetId) as ChangedFileRow[]).map(changedFileFromRow);
  }

  listChangedFilesByRun(runId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT f.*, c.session_id, c.run_id
      FROM workspace_changed_files f
      INNER JOIN workspace_changes c ON c.change_id = f.change_id
      WHERE c.run_id = ?
      ORDER BY f.created_at ASC, f.changed_file_id ASC
    `).all(runId) as ChangedFileRow[]).map(changedFileFromRow);
  }

  updateChangedFileRestoreState(input: {
    changedFileId: string;
    restoreState: WorkspaceChangedFile['restoreState'];
    updatedAt: string;
    metadata?: WorkspaceChangedFile['metadata'];
  }): WorkspaceChangedFile | undefined {
    const existing = this.getChangedFile(input.changedFileId);
    if (!existing) {
      return undefined;
    }
    const parsed = WorkspaceChangedFileSchema.parse({
      ...existing,
      restoreState: input.restoreState,
      updatedAt: input.updatedAt,
      metadata: input.metadata,
    });
    this.database.prepare(`
      UPDATE workspace_changed_files
      SET restore_state = ?, updated_at = ?, metadata_json = ?
      WHERE changed_file_id = ?
    `).run(
      parsed.restoreState,
      parsed.updatedAt,
      stringifyJson(changedFileMetadataFrom(parsed)),
      parsed.changedFileId,
    );
    return this.getChangedFile(parsed.changedFileId);
  }

  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined {
    const changeSet = this.getWorkspaceChange(changeSetId);
    if (!changeSet) {
      return undefined;
    }
    const row = this.database.prepare(`
      SELECT
        COUNT(*) AS changed_file_count,
        COALESCE(SUM(CASE WHEN restore_state = 'restorable' THEN 1 ELSE 0 END), 0) AS restorable_count,
        COALESCE(SUM(CASE WHEN restore_state = 'restored' THEN 1 ELSE 0 END), 0) AS restored_count,
        COALESCE(SUM(CASE WHEN restore_state = 'conflict' THEN 1 ELSE 0 END), 0) AS conflict_count,
        COALESCE(SUM(CASE WHEN restore_state = 'restore_failed' THEN 1 ELSE 0 END), 0) AS failed_count,
        MAX(updated_at) AS updated_at
      FROM workspace_changed_files
      WHERE change_id = ?
    `).get(changeSetId) as SummaryRow;

    return WorkspaceChangeSummarySchema.parse({
      changeSetId: changeSet.changeSetId,
      sessionId: changeSet.sessionId,
      runId: changeSet.runId,
      changedFileCount: row.changed_file_count,
      restorableCount: row.restorable_count,
      restoredCount: row.restored_count,
      conflictCount: row.conflict_count,
      failedCount: row.failed_count,
      hasRestorableChanges: row.restorable_count > 0,
      updatedAt: row.updated_at ?? changeSet.finalizedAt ?? changeSet.createdAt,
    });
  }

  listChangeSummariesByRun(runId: string): WorkspaceChangeSummary[] {
    return this.listWorkspaceChangesByRun(runId)
      .map((changeSet) => this.getChangeSummary(changeSet.changeSetId))
      .filter((summary): summary is WorkspaceChangeSummary => Boolean(summary));
  }

  createRestoreOperation(request: WorkspaceRestoreRequest): WorkspaceRestoreRequest {
    const parsed = WorkspaceRestoreRequestSchema.parse(request);
    const existing = this.getRestoreOperation(parsed.restoreRequestId);
    if (existing) {
      assertDurableRecordMatches('Restore request', parsed.restoreRequestId, existing, parsed);
      return parsed;
    }
    const changeSet = requireChangeSet(this, parsed.changeSetId, 'restore request');
    assertSameSessionRun({
      subject: 'Restore request',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'change set',
      referenceSessionId: changeSet.sessionId,
      referenceRunId: changeSet.runId,
    });

    this.database.prepare(`
      INSERT INTO workspace_restore_operations (
        restore_id, change_id, requested_by, status, requested_at,
        completed_at, result_json, error_json, metadata_json
      ) VALUES (
        @restore_id, @change_id, @requested_by, @status, @requested_at,
        @completed_at, NULL, NULL, @metadata_json
      )
    `).run({
      restore_id: parsed.restoreRequestId,
      change_id: parsed.changeSetId,
      requested_by: parsed.requestedBy,
      status: parsed.status,
      requested_at: parsed.requestedAt,
      completed_at: parsed.completedAt ?? null,
      metadata_json: stringifyJson({ userMetadata: parsed.metadata } satisfies RestoreOperationMetadata),
    });
    return parsed;
  }

  private getRestoreOperation(restoreRequestId: string): WorkspaceRestoreRequest | undefined {
    const row = this.database.prepare('SELECT * FROM workspace_restore_operations WHERE restore_id = ?')
      .get(restoreRequestId) as RestoreOperationRow | undefined;
    return row ? restoreOperationFromRow(this.database, row) : undefined;
  }

  updateRestoreOperation(input: {
    restoreRequestId: string;
    status: WorkspaceRestoreRequest['status'];
    completedAt?: string;
    metadata?: WorkspaceRestoreRequest['metadata'];
  }): WorkspaceRestoreRequest | undefined {
    const existing = this.getRestoreOperation(input.restoreRequestId);
    if (!existing) {
      return undefined;
    }
    const metadata = parseJson<RestoreOperationMetadata>(
      this.database.prepare('SELECT metadata_json FROM workspace_restore_operations WHERE restore_id = ?')
        .get(input.restoreRequestId) as { metadata_json: string | null } | undefined,
    ) ?? {};
    metadata.userMetadata = input.metadata;
    const parsed = WorkspaceRestoreRequestSchema.parse({
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      metadata: input.metadata,
    });
    this.database.prepare(`
      UPDATE workspace_restore_operations
      SET status = ?, completed_at = ?, metadata_json = ?
      WHERE restore_id = ?
    `).run(parsed.status, parsed.completedAt ?? null, stringifyJson(metadata), parsed.restoreRequestId);
    return this.getRestoreOperation(parsed.restoreRequestId);
  }

  completeRestoreOperation(result: WorkspaceRestoreResult): WorkspaceRestoreResult {
    const parsed = WorkspaceRestoreResultSchema.parse(result);
    const request = this.getRestoreOperation(parsed.restoreRequestId);
    if (!request) {
      throw new Error(`Cannot save restore result without restore request: ${parsed.restoreRequestId}`);
    }
    const existing = this.getCompletedRestoreOperation(parsed.restoreResultId);
    if (existing) {
      assertDurableRecordMatches('Restore result', parsed.restoreResultId, existing, parsed);
      return parsed;
    }
    assertSameSessionRun({
      subject: 'Restore result',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'request',
      referenceSessionId: request.sessionId,
      referenceRunId: request.runId,
    });
    const changeSet = requireChangeSet(this, parsed.changeSetId, 'restore result');
    assertSameSessionRun({
      subject: 'Restore result',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'change set',
      referenceSessionId: changeSet.sessionId,
      referenceRunId: changeSet.runId,
    });

    const metadata = operationMetadata(this.database, parsed.restoreRequestId);
    metadata.resultMetadata = parsed.metadata;
    const restoreId = this.restoreOperationIdForCompletion(parsed.restoreRequestId, parsed.restoreResultId);
    if (restoreId !== parsed.restoreRequestId) {
      this.database.prepare(`
        INSERT INTO workspace_restore_operations (
          restore_id, change_id, requested_by, status, requested_at,
          completed_at, result_json, error_json, metadata_json
        )
        SELECT
          @restore_id, change_id, requested_by, status, requested_at,
          completed_at, NULL, NULL, metadata_json
        FROM workspace_restore_operations
        WHERE restore_id = @request_id
      `).run({
        restore_id: restoreId,
        request_id: parsed.restoreRequestId,
      });
    }
    this.database.prepare(`
      UPDATE workspace_restore_operations
      SET result_json = ?, error_json = ?, metadata_json = ?
      WHERE restore_id = ?
    `).run(
      stringifyJson(parsed),
      parsed.error ? stringifyJson(parsed.error) : null,
      stringifyJson(metadata),
      restoreId,
    );
    return parsed;
  }

  recordRestoreFileResult(fileResult: WorkspaceRestoreFileResult): WorkspaceRestoreFileResult {
    const parsed = WorkspaceRestoreFileResultSchema.parse(fileResult);
    const existing = this.getRestoreFileResult(parsed.restoreFileResultId);
    if (existing) {
      assertDurableRecordMatches('Restore file result', parsed.restoreFileResultId, existing, parsed);
      return parsed;
    }
    const restoreId = this.restoreIdForCompletedOperation(parsed.restoreResultId);
    if (!restoreId) {
      throw new Error(`Cannot save restore file result without restore result: ${parsed.restoreResultId}`);
    }
    const restoreResult = this.getCompletedRestoreOperation(parsed.restoreResultId);
    const changedFile = this.getChangedFile(parsed.changedFileId);
    if (!changedFile) {
      throw new Error(`Cannot save restore file result without changed file: ${parsed.changedFileId}`);
    }
    if (restoreResult && changedFile.changeSetId !== restoreResult.changeSetId) {
      throw new Error(`Restore file result changedFileId ${parsed.changedFileId} belongs to changeSetId ${changedFile.changeSetId}, not ${restoreResult.changeSetId}`);
    }
    if (parsed.projectPath !== changedFile.projectPath) {
      throw new Error(`Restore file result projectPath ${parsed.projectPath} does not match changed file projectPath ${changedFile.projectPath}`);
    }
    this.database.prepare(`
      INSERT INTO workspace_restore_file_results (
        file_result_id, restore_id, changed_file_id, path, status,
        conflict_reason, error_json, restored_at, metadata_json
      ) VALUES (
        @file_result_id, @restore_id, @changed_file_id, @path, @status,
        @conflict_reason, @error_json, @restored_at, @metadata_json
      )
    `).run({
      file_result_id: parsed.restoreFileResultId,
      restore_id: restoreId,
      changed_file_id: parsed.changedFileId,
      path: parsed.projectPath,
      status: parsed.status,
      conflict_reason: parsed.conflictReason ?? null,
      error_json: parsed.error ? stringifyJson(parsed.error) : null,
      restored_at: parsed.restoredAt ?? null,
      metadata_json: stringifyJson({
        restoreResultId: parsed.restoreResultId,
        userMetadata: parsed.metadata,
      } satisfies RestoreFileResultMetadata),
    });
    return parsed;
  }

  listRestoreFileResults(restoreResultId: string): WorkspaceRestoreFileResult[] {
    const restoreId = this.restoreIdForCompletedOperation(restoreResultId);
    if (!restoreId) {
      return [];
    }
    return (this.database.prepare(`
      SELECT *
      FROM workspace_restore_file_results
      WHERE restore_id = ?
      ORDER BY COALESCE(restored_at, '') ASC, file_result_id ASC
    `).all(restoreId) as RestoreFileResultRow[])
      .map(restoreFileResultFromRow);
  }

  private getRestoreFileResult(restoreFileResultId: string): WorkspaceRestoreFileResult | undefined {
    const row = this.database.prepare('SELECT * FROM workspace_restore_file_results WHERE file_result_id = ?')
      .get(restoreFileResultId) as RestoreFileResultRow | undefined;
    return row ? restoreFileResultFromRow(row) : undefined;
  }

  private getCompletedRestoreOperation(restoreResultId: string): WorkspaceRestoreResult | undefined {
    return this.allCompletedRestoreOperations()
      .find((result) => result.restoreResultId === restoreResultId);
  }

  private allCompletedRestoreOperations(): WorkspaceRestoreResult[] {
    return (this.database.prepare(`
      SELECT result_json
      FROM workspace_restore_operations
      WHERE result_json IS NOT NULL
    `).all() as Array<{ result_json: string | null }>)
      .map((row) => parseJson<WorkspaceRestoreResult>(row.result_json))
      .filter((result): result is WorkspaceRestoreResult => Boolean(result))
      .map((result) => WorkspaceRestoreResultSchema.parse(result));
  }

  private restoreIdForCompletedOperation(restoreResultId: string): string | undefined {
    const rows = this.database.prepare(`
      SELECT restore_id, result_json
      FROM workspace_restore_operations
      WHERE result_json IS NOT NULL
    `).all() as Array<{ restore_id: string; result_json: string | null }>;
    return rows.find((row) => parseJson<WorkspaceRestoreResult>(row.result_json)?.restoreResultId === restoreResultId)?.restore_id;
  }

  private restoreOperationIdForCompletion(restoreRequestId: string, restoreResultId: string): string {
    const row = this.database.prepare('SELECT result_json FROM workspace_restore_operations WHERE restore_id = ?')
      .get(restoreRequestId) as { result_json: string | null } | undefined;
    if (!row?.result_json) {
      return restoreRequestId;
    }
    return `${restoreRequestId}:result:${restoreResultId}`;
  }
}

function snapshotFromRow(row: SnapshotRow): WorkspaceSnapshotContent {
  if (!row.session_id || !row.run_id) {
    throw new Error(`Snapshot content ${row.snapshot_id} no longer has an owning run`);
  }
  const metadata = parseJson<SnapshotMetadata>(row.metadata_json);
  return WorkspaceSnapshotContentSchema.parse({
    contentRefId: row.snapshot_id,
    sessionId: row.session_id,
    runId: row.run_id,
    projectPath: row.path,
    storage: row.storage,
    encoding: row.encoding,
    sha256: row.sha256,
    byteLength: row.byte_length,
    contentText: row.content_text ?? '',
    createdAt: row.created_at,
    metadata: metadata?.userMetadata,
  });
}

function changeSetFromRow(row: ChangeRow): WorkspaceChangeSet {
  const metadata = parseJson<ChangeMetadata>(row.metadata_json);
  return WorkspaceChangeSetSchema.parse({
    changeSetId: row.change_id,
    sessionId: row.session_id,
    runId: row.run_id,
    stepId: metadata?.stepId,
    sourceEntryId: metadata?.sourceEntryId,
    responseMessageId: metadata?.responseMessageId,
    status: row.status,
    changedFileCount: row.changed_file_count,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at ?? undefined,
    metadata: metadata?.userMetadata,
  });
}

function changedFileFromRow(row: ChangedFileRow): WorkspaceChangedFile {
  const metadata = parseJson<ChangedFileMetadata>(row.metadata_json);
  return WorkspaceChangedFileSchema.parse({
    changedFileId: row.changed_file_id,
    changeSetId: row.change_id,
    workspaceCheckpointId: metadata?.workspaceCheckpointId,
    sessionId: row.session_id,
    runId: row.run_id,
    stepId: metadata?.stepId,
    toolCallId: metadata?.toolCallId,
    toolExecutionId: metadata?.toolExecutionId,
    sourceEntryId: metadata?.sourceEntryId,
    responseMessageId: metadata?.responseMessageId,
    projectPath: row.path,
    changeKind: row.change_kind,
    restoreState: row.restore_state,
    beforeExists: row.before_exists === 1,
    beforeContentRefId: row.before_snapshot_id ?? undefined,
    beforeHash: row.before_hash ?? undefined,
    beforeByteLength: metadata?.beforeByteLength,
    afterExists: row.after_exists === 1,
    afterContentRefId: row.after_snapshot_id ?? undefined,
    afterHash: row.after_hash ?? undefined,
    afterByteLength: metadata?.afterByteLength,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: metadata?.userMetadata,
  });
}

function restoreOperationFromRow(database: MegumiDatabase, row: RestoreOperationRow): WorkspaceRestoreRequest {
  const metadata = parseJson<RestoreOperationMetadata>(row.metadata_json);
  const owner = restoreOperationSessionRun(database, row);
  return WorkspaceRestoreRequestSchema.parse({
    restoreRequestId: row.restore_id,
    changeSetId: row.change_id,
    sessionId: owner.sessionId,
    runId: owner.runId,
    requestedBy: row.requested_by,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at ?? undefined,
    metadata: metadata?.userMetadata,
  });
}

function restoreOperationSessionRun(database: MegumiDatabase, row: RestoreOperationRow): { sessionId: string; runId: string } {
  const result = parseJson<WorkspaceRestoreResult>(row.result_json);
  if (result) {
    return { sessionId: result.sessionId, runId: result.runId };
  }
  const change = database.prepare('SELECT session_id, run_id FROM workspace_changes WHERE change_id = ?')
    .get(row.change_id) as { session_id: string; run_id: string } | undefined;
  if (!change) {
    throw new Error(`Restore operation changeId ${row.change_id} does not exist.`);
  }
  return { sessionId: change.session_id, runId: change.run_id };
}

function restoreFileResultFromRow(row: RestoreFileResultRow): WorkspaceRestoreFileResult {
  const metadata = parseJson<RestoreFileResultMetadata>(row.metadata_json);
  return WorkspaceRestoreFileResultSchema.parse({
    restoreFileResultId: row.file_result_id,
    restoreResultId: metadata?.restoreResultId,
    changedFileId: row.changed_file_id,
    projectPath: row.path,
    status: row.status,
    conflictReason: row.conflict_reason ?? undefined,
    error: parseJson(row.error_json),
    restoredAt: row.restored_at ?? undefined,
    metadata: metadata?.userMetadata,
  });
}

function changeMetadataFromChangeSet(changeSet: WorkspaceChangeSet): ChangeMetadata {
  return {
    userMetadata: changeSet.metadata,
    stepId: changeSet.stepId,
    sourceEntryId: changeSet.sourceEntryId,
    responseMessageId: changeSet.responseMessageId,
  };
}

function changedFileMetadataFrom(changedFile: WorkspaceChangedFile): ChangedFileMetadata {
  return {
    userMetadata: changedFile.metadata,
    workspaceCheckpointId: changedFile.workspaceCheckpointId,
    stepId: changedFile.stepId,
    toolCallId: changedFile.toolCallId,
    toolExecutionId: changedFile.toolExecutionId,
    sourceEntryId: changedFile.sourceEntryId,
    responseMessageId: changedFile.responseMessageId,
    beforeByteLength: changedFile.beforeByteLength,
    afterByteLength: changedFile.afterByteLength,
  };
}

function metadataForChangeSet(database: MegumiDatabase, changeSetId: string): ChangeMetadata {
  const row = database.prepare('SELECT metadata_json FROM workspace_changes WHERE change_id = ?')
    .get(changeSetId) as { metadata_json: string | null } | undefined;
  return parseJson<ChangeMetadata>(row?.metadata_json) ?? {};
}

function writeChangeMetadata(database: MegumiDatabase, changeSetId: string, metadata: ChangeMetadata): void {
  database.prepare('UPDATE workspace_changes SET metadata_json = ? WHERE change_id = ?')
    .run(stringifyJson(metadata), changeSetId);
}

function operationMetadata(database: MegumiDatabase, restoreId: string): RestoreOperationMetadata {
  const row = database.prepare('SELECT metadata_json FROM workspace_restore_operations WHERE restore_id = ?')
    .get(restoreId) as { metadata_json: string | null } | undefined;
  return parseJson<RestoreOperationMetadata>(row?.metadata_json) ?? {};
}

function requireChangeSet(repo: WorkspaceChangeRepository, changeSetId: string, subject: string): WorkspaceChangeSet {
  const changeSet = repo.getWorkspaceChange(changeSetId);
  if (!changeSet) {
    throw new Error(`Cannot save ${subject} without change set: ${changeSetId}`);
  }
  return changeSet;
}

function countChangedFiles(database: MegumiDatabase, changeSetId: string): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM workspace_changed_files WHERE change_id = ?')
    .get(changeSetId) as { count: number };
  return row.count;
}

function updateChangeFileCount(database: MegumiDatabase, changeSetId: string): void {
  database.prepare('UPDATE workspace_changes SET changed_file_count = ? WHERE change_id = ?')
    .run(countChangedFiles(database, changeSetId), changeSetId);
}

function getRunContext(
  database: MegumiDatabase,
  subject: string,
  sessionId: string,
  runId: string,
): RunContextRow {
  const row = database.prepare('SELECT session_id, workspace_id FROM agent_loop_runs WHERE run_id = ?')
    .get(runId) as RunContextRow | undefined;
  if (!row) {
    throw new Error(`${subject} runId ${runId} does not exist`);
  }
  if (row.session_id !== sessionId) {
    throw new Error(`${subject} runId ${runId} does not belong to sessionId ${sessionId}`);
  }
  return row;
}

function validateToolCallRef(database: MegumiDatabase, subject: string, toolCallId: string | undefined, runId: string): void {
  if (!toolCallId) {
    return;
  }
  const row = database.prepare('SELECT run_id FROM tool_calls WHERE tool_call_id = ?')
    .get(toolCallId) as { run_id: string } | undefined;
  if (row && row.run_id !== runId) {
    throw new Error(`${subject} toolCallId ${toolCallId} does not belong to runId ${runId}`);
  }
}

function validateSnapshotOwner(
  database: MegumiDatabase,
  subject: string,
  fieldName: string,
  snapshotId: string | undefined,
  owner: Pick<
    WorkspaceChangedFile,
    'sessionId' | 'runId' | 'projectPath' | 'beforeHash' | 'beforeByteLength' | 'afterHash' | 'afterByteLength'
  >,
): void {
  if (!snapshotId) {
    return;
  }
  const snapshot = new WorkspaceChangeRepository(database).getSnapshotContent(snapshotId);
  if (!snapshot) {
    throw new Error(`${subject} ${fieldName} ${snapshotId} does not exist`);
  }
  if (snapshot.sessionId !== owner.sessionId || snapshot.runId !== owner.runId || snapshot.projectPath !== owner.projectPath) {
    throw new Error(`${subject} ${fieldName} ${snapshotId} belongs to sessionId ${snapshot.sessionId}/runId ${snapshot.runId}/projectPath ${snapshot.projectPath}, not sessionId ${owner.sessionId}/runId ${owner.runId}/projectPath ${owner.projectPath}`);
  }
  const expectedHash = fieldName === 'beforeContentRefId' ? owner.beforeHash : owner.afterHash;
  if (expectedHash && expectedHash !== snapshot.sha256) {
    throw new Error(`${subject} ${fieldName} ${snapshotId} sha256 ${snapshot.sha256} does not match ${fieldName === 'beforeContentRefId' ? 'beforeHash' : 'afterHash'} ${expectedHash}`);
  }
  const expectedByteLength = fieldName === 'beforeContentRefId' ? owner.beforeByteLength : owner.afterByteLength;
  if (expectedByteLength !== undefined && expectedByteLength !== snapshot.byteLength) {
    throw new Error(`${subject} ${fieldName} ${snapshotId} byteLength ${snapshot.byteLength} does not match ${fieldName === 'beforeContentRefId' ? 'beforeByteLength' : 'afterByteLength'} ${expectedByteLength}`);
  }
}

function assertSameSessionRun(input: {
  subject: string;
  subjectSessionId: string;
  subjectRunId: string;
  referenceName: string;
  referenceSessionId: string;
  referenceRunId: string;
  inverseMessage?: boolean;
}): void {
  if (input.subjectSessionId !== input.referenceSessionId) {
    throw new Error(input.inverseMessage
      ? `${input.subject} belongs to sessionId ${input.subjectSessionId}, not ${input.referenceSessionId}`
      : `${input.subject} sessionId ${input.subjectSessionId} does not match ${input.referenceName} sessionId ${input.referenceSessionId}`);
  }
  if (input.subjectRunId !== input.referenceRunId) {
    throw new Error(input.inverseMessage
      ? `${input.subject} belongs to runId ${input.subjectRunId}, not ${input.referenceRunId}`
      : `${input.subject} runId ${input.subjectRunId} does not match ${input.referenceName} runId ${input.referenceRunId}`);
  }
}

function assertDurableRecordMatches<T>(subject: string, id: string, existing: T, next: T): void {
  if (!isDeepEqual(existing, next)) {
    throw new Error(`${subject} ${id} already exists with different durable fields`);
  }
}

function assertSnapshotDurableFieldsMatch(
  existing: WorkspaceSnapshotContent,
  next: WorkspaceSnapshotContent,
): void {
  const existingDurable = { ...existing, metadata: undefined };
  const nextDurable = { ...next, metadata: undefined };
  if (!isDeepEqual(existingDurable, nextDurable)) {
    throw new Error(`Snapshot content ${next.contentRefId} already exists with different durable fields`);
  }
}

function assertSnapshotContentMatchesDeclaredIntegrity(content: WorkspaceSnapshotContent): void {
  const actualSha256 = createHash('sha256').update(content.contentText, 'utf8').digest('hex');
  if (actualSha256 !== content.sha256) {
    throw new Error(`Snapshot content ${content.contentRefId} sha256 does not match contentText`);
  }
  const actualByteLength = Buffer.byteLength(content.contentText, 'utf8');
  if (actualByteLength !== content.byteLength) {
    throw new Error(`Snapshot content ${content.contentRefId} byteLength does not match contentText UTF-8 byte length`);
  }
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(dropUndefined(value));
}

function parseJson<T = unknown>(value: string | null | undefined | { metadata_json: string | null } | { result_json: string | null }): T | undefined {
  const json = typeof value === 'object' && value !== null
    ? 'metadata_json' in value
      ? value.metadata_json
      : value.result_json
    : value;
  return json ? JSON.parse(json) as T : undefined;
}

function dropUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(dropUndefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, dropUndefined(entry)]),
    );
  }
  return value;
}
