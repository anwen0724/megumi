import { createHash } from 'node:crypto';

import type { RuntimeError } from '@megumi/shared/runtime';
import {
  WorkspaceChangedFileSchema,
  WorkspaceChangeSetSchema,
  WorkspaceChangeSummarySchema,
  WorkspaceCheckpointSchema,
  WorkspaceRestoreFileResultSchema,
  WorkspaceRestoreRequestSchema,
  WorkspaceRestoreResultSchema,
  WorkspaceSnapshotContentSchema,
  type WorkspaceChangedFile,
  type WorkspaceChangeSet,
  type WorkspaceChangeSummary,
  type WorkspaceCheckpoint,
  type WorkspaceRestoreFileResult,
  type WorkspaceRestoreRequest,
  type WorkspaceRestoreResult,
  type WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';

import type { MegumiDatabase } from '../connection';

interface WorkspaceSnapshotContentRow {
  content_ref_id: string;
  session_id: string;
  run_id: string;
  project_path: string;
  storage: WorkspaceSnapshotContent['storage'];
  encoding: WorkspaceSnapshotContent['encoding'];
  sha256: string;
  byte_length: number;
  content_text: string;
  created_at: string;
  metadata_json: string | null;
}

interface WorkspaceChangeSetRow {
  change_set_id: string;
  session_id: string;
  run_id: string;
  step_id: string | null;
  source_entry_id: string | null;
  response_message_id: string | null;
  status: WorkspaceChangeSet['status'];
  changed_file_count: number;
  created_at: string;
  finalized_at: string | null;
  metadata_json: string | null;
}

interface WorkspaceCheckpointRow {
  workspace_checkpoint_id: string;
  session_id: string;
  run_id: string;
  step_id: string | null;
  tool_call_id: string | null;
  tool_execution_id: string | null;
  source_entry_id: string | null;
  response_message_id: string | null;
  change_set_id: string | null;
  project_path: string;
  before_exists: 0 | 1;
  before_content_ref_id: string | null;
  before_hash: string | null;
  before_byte_length: number | null;
  created_at: string;
  metadata_json: string | null;
}

interface WorkspaceChangedFileRow {
  changed_file_id: string;
  change_set_id: string;
  workspace_checkpoint_id: string;
  session_id: string;
  run_id: string;
  step_id: string | null;
  tool_call_id: string | null;
  tool_execution_id: string | null;
  source_entry_id: string | null;
  response_message_id: string | null;
  project_path: string;
  change_kind: WorkspaceChangedFile['changeKind'];
  restore_state: WorkspaceChangedFile['restoreState'];
  before_exists: 0 | 1;
  before_content_ref_id: string | null;
  before_hash: string | null;
  before_byte_length: number | null;
  after_exists: 0 | 1;
  after_content_ref_id: string | null;
  after_hash: string | null;
  after_byte_length: number | null;
  created_at: string;
  updated_at: string;
  metadata_json: string | null;
}

interface WorkspaceRestoreRequestRow {
  restore_request_id: string;
  change_set_id: string;
  session_id: string;
  run_id: string;
  requested_by: WorkspaceRestoreRequest['requestedBy'];
  status: WorkspaceRestoreRequest['status'];
  requested_at: string;
  completed_at: string | null;
  metadata_json: string | null;
}

interface WorkspaceRestoreResultRow {
  restore_result_id: string;
  restore_request_id: string;
  change_set_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceRestoreResult['status'];
  restored_at: string;
  error_json: string | null;
  metadata_json: string | null;
}

interface WorkspaceRestoreFileResultRow {
  restore_file_result_id: string;
  restore_result_id: string;
  changed_file_id: string;
  project_path: string;
  status: WorkspaceRestoreFileResult['status'];
  conflict_reason: WorkspaceRestoreFileResult['conflictReason'] | null;
  error_json: string | null;
  restored_at: string | null;
  metadata_json: string | null;
}

interface ChangeSummaryCountRow {
  changed_file_count: number;
  restorable_count: number;
  restored_count: number;
  conflict_count: number;
  failed_count: number;
  updated_at: string | null;
}

export class WorkspaceChangeRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveSnapshotContent(content: WorkspaceSnapshotContent): WorkspaceSnapshotContent {
    const parsed = WorkspaceSnapshotContentSchema.parse(content);
    assertSnapshotContentMatchesDeclaredIntegrity(parsed);
    assertRunBelongsToSession(this.database, 'Snapshot content', parsed.runId, parsed.sessionId);
    const existing = this.getSnapshotContent(parsed.contentRefId);
    if (existing) {
      assertSnapshotDurableFieldsMatch(existing, parsed);
      this.database.prepare(`
        UPDATE workspace_snapshot_contents
        SET metadata_json = ?
        WHERE content_ref_id = ?
      `).run(stringifyOptionalJson(parsed.metadata), parsed.contentRefId);
      return parsed;
    }

    this.database.prepare(`
      INSERT INTO workspace_snapshot_contents (
        content_ref_id,
        session_id,
        run_id,
        project_path,
        storage,
        encoding,
        sha256,
        byte_length,
        content_text,
        created_at,
        metadata_json
      ) VALUES (
        @content_ref_id,
        @session_id,
        @run_id,
        @project_path,
        @storage,
        @encoding,
        @sha256,
        @byte_length,
        @content_text,
        @created_at,
        @metadata_json
      )
    `).run({
      content_ref_id: parsed.contentRefId,
      session_id: parsed.sessionId,
      run_id: parsed.runId,
      project_path: parsed.projectPath,
      storage: parsed.storage,
      encoding: parsed.encoding,
      sha256: parsed.sha256,
      byte_length: parsed.byteLength,
      content_text: parsed.contentText,
      created_at: parsed.createdAt,
      metadata_json: stringifyOptionalJson(parsed.metadata),
    });
    return parsed;
  }

  getSnapshotContent(contentRefId: string): WorkspaceSnapshotContent | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_snapshot_contents
      WHERE content_ref_id = ?
    `).get(contentRefId) as WorkspaceSnapshotContentRow | undefined;
    return row ? snapshotContentFromRow(row) : undefined;
  }

  saveChangeSet(changeSet: WorkspaceChangeSet): WorkspaceChangeSet {
    const parsed = WorkspaceChangeSetSchema.parse(changeSet);
    const existing = this.getChangeSet(parsed.changeSetId);
    if (existing) {
      assertDurableRecordMatches('Workspace change set', parsed.changeSetId, existing, parsed);
      return parsed;
    }
    if (parsed.status !== 'open' || parsed.finalizedAt !== undefined) {
      throw new Error(`Workspace change set ${parsed.changeSetId} cannot be finalized through saveChangeSet`);
    }
    if (parsed.changedFileCount !== 0) {
      throw new Error(`Workspace change set ${parsed.changeSetId} changedFileCount cannot be set through saveChangeSet`);
    }
    assertRunBelongsToSession(this.database, 'Workspace change set', parsed.runId, parsed.sessionId);
    validateOptionalLifecycleRefs(this.database, 'Workspace change set', parsed);

    this.database.prepare(`
      INSERT INTO workspace_change_sets (
        change_set_id,
        session_id,
        run_id,
        step_id,
        source_entry_id,
        response_message_id,
        status,
        changed_file_count,
        created_at,
        finalized_at,
        metadata_json
      ) VALUES (
        @change_set_id,
        @session_id,
        @run_id,
        @step_id,
        @source_entry_id,
        @response_message_id,
        @status,
        @changed_file_count,
        @created_at,
        @finalized_at,
        @metadata_json
      )
    `).run(changeSetParams(parsed));
    return parsed;
  }

  getChangeSet(changeSetId: string): WorkspaceChangeSet | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_change_sets
      WHERE change_set_id = ?
    `).get(changeSetId) as WorkspaceChangeSetRow | undefined;
    return row ? changeSetFromRow(row) : undefined;
  }

  listChangeSetsByRun(runId: string): WorkspaceChangeSet[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_change_sets
      WHERE run_id = ?
      ORDER BY created_at ASC, change_set_id ASC
    `).all(runId) as WorkspaceChangeSetRow[]).map(changeSetFromRow);
  }

  finalizeChangeSet(changeSetId: string, finalizedAt: string): WorkspaceChangeSet | undefined {
    const existing = this.getChangeSet(changeSetId);
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
      UPDATE workspace_change_sets
      SET status = 'finalized',
        changed_file_count = ?,
        finalized_at = ?
      WHERE change_set_id = ?
    `).run(changedFileCount, finalizedAt, changeSetId);
    return this.getChangeSet(changeSetId);
  }

  saveWorkspaceCheckpoint(checkpoint: WorkspaceCheckpoint): WorkspaceCheckpoint {
    const parsed = WorkspaceCheckpointSchema.parse(checkpoint);
    const existing = this.getWorkspaceCheckpoint(parsed.workspaceCheckpointId);
    if (existing) {
      assertDurableRecordMatches(
        'Workspace checkpoint',
        parsed.workspaceCheckpointId,
        existing,
        parsed,
      );
      return parsed;
    }

    if (parsed.changeSetId) {
      const changeSet = this.getChangeSet(parsed.changeSetId);
      if (changeSet) {
        assertSameSessionRun({
          subject: 'Workspace checkpoint',
          subjectSessionId: parsed.sessionId,
          subjectRunId: parsed.runId,
          referenceName: 'change set',
          referenceSessionId: changeSet.sessionId,
          referenceRunId: changeSet.runId,
        });
        if (changeSet.status === 'finalized') {
          throw new Error(`Cannot save workspace checkpoint ${parsed.workspaceCheckpointId} into finalized change set ${parsed.changeSetId}`);
        }
      }
    }
    assertRunBelongsToSession(this.database, 'Workspace checkpoint', parsed.runId, parsed.sessionId);
    validateOptionalLifecycleRefs(this.database, 'Workspace checkpoint', parsed);
    if (parsed.toolCallId) {
      assertToolCallBelongsToRun(this.database, 'Workspace checkpoint', parsed.toolCallId, parsed.runId);
    }
    if (parsed.toolExecutionId) {
      assertToolExecutionBelongsToRun(this.database, 'Workspace checkpoint', parsed.toolExecutionId, parsed.runId);
    }
    if (parsed.beforeContentRefId) {
      assertSnapshotContentRefBelongsToOwner(
        this.database,
        'Workspace checkpoint',
        'beforeContentRefId',
        parsed.beforeContentRefId,
        parsed.sessionId,
        parsed.runId,
        parsed.projectPath,
        'beforeHash',
        parsed.beforeHash,
        'beforeByteLength',
        parsed.beforeByteLength,
      );
    }

    this.database.prepare(`
      INSERT INTO workspace_checkpoints (
        workspace_checkpoint_id,
        change_set_id,
        session_id,
        run_id,
        step_id,
        tool_call_id,
        tool_execution_id,
        source_entry_id,
        response_message_id,
        project_path,
        before_exists,
        before_content_ref_id,
        before_hash,
        before_byte_length,
        created_at,
        metadata_json
      ) VALUES (
        @workspace_checkpoint_id,
        @change_set_id,
        @session_id,
        @run_id,
        @step_id,
        @tool_call_id,
        @tool_execution_id,
        @source_entry_id,
        @response_message_id,
        @project_path,
        @before_exists,
        @before_content_ref_id,
        @before_hash,
        @before_byte_length,
        @created_at,
        @metadata_json
      )
    `).run(checkpointParams(parsed));
    return parsed;
  }

  getWorkspaceCheckpoint(workspaceCheckpointId: string): WorkspaceCheckpoint | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_checkpoints
      WHERE workspace_checkpoint_id = ?
    `).get(workspaceCheckpointId) as WorkspaceCheckpointRow | undefined;
    return row ? checkpointFromRow(row) : undefined;
  }

  listCheckpointsByChangeSet(changeSetId: string): WorkspaceCheckpoint[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_checkpoints
      WHERE change_set_id = ?
      ORDER BY created_at ASC, workspace_checkpoint_id ASC
    `).all(changeSetId) as WorkspaceCheckpointRow[]).map(checkpointFromRow);
  }

  saveChangedFile(changedFile: WorkspaceChangedFile): WorkspaceChangedFile {
    const parsed = WorkspaceChangedFileSchema.parse(changedFile);
    const existing = this.getChangedFile(parsed.changedFileId);
    if (existing) {
      assertDurableRecordMatches('Changed file', parsed.changedFileId, existing, parsed);
      return parsed;
    }

    const changeSet = this.getChangeSet(parsed.changeSetId);
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
    assertRunBelongsToSession(this.database, 'Changed file', parsed.runId, parsed.sessionId);
    validateOptionalLifecycleRefs(this.database, 'Changed file', parsed);
    if (parsed.toolCallId) {
      assertToolCallBelongsToRun(this.database, 'Changed file', parsed.toolCallId, parsed.runId);
    }
    if (parsed.toolExecutionId) {
      assertToolExecutionBelongsToRun(this.database, 'Changed file', parsed.toolExecutionId, parsed.runId);
    }

    const checkpoint = this.getWorkspaceCheckpoint(parsed.workspaceCheckpointId);
    if (!checkpoint) {
      throw new Error(`Cannot save changed file without workspace checkpoint: ${parsed.workspaceCheckpointId}`);
    }
    assertSameSessionRun({
      subject: `Changed file workspaceCheckpointId ${parsed.workspaceCheckpointId}`,
      subjectSessionId: checkpoint.sessionId,
      subjectRunId: checkpoint.runId,
      referenceName: 'changed file',
      referenceSessionId: parsed.sessionId,
      referenceRunId: parsed.runId,
      inverseMessage: true,
    });
    if (checkpoint.changeSetId && checkpoint.changeSetId !== parsed.changeSetId) {
      throw new Error(
        `Changed file workspaceCheckpointId ${parsed.workspaceCheckpointId} belongs to changeSetId ${checkpoint.changeSetId}, not ${parsed.changeSetId}`,
      );
    }
    if (parsed.projectPath !== checkpoint.projectPath) {
      throw new Error(
        `Changed file projectPath ${parsed.projectPath} does not match checkpoint projectPath ${checkpoint.projectPath}`,
      );
    }
    if (parsed.beforeContentRefId) {
      assertSnapshotContentRefBelongsToOwner(
        this.database,
        'Changed file',
        'beforeContentRefId',
        parsed.beforeContentRefId,
        parsed.sessionId,
        parsed.runId,
        parsed.projectPath,
        'beforeHash',
        parsed.beforeHash,
        'beforeByteLength',
        parsed.beforeByteLength,
      );
    }
    if (parsed.afterContentRefId) {
      assertSnapshotContentRefBelongsToOwner(
        this.database,
        'Changed file',
        'afterContentRefId',
        parsed.afterContentRefId,
        parsed.sessionId,
        parsed.runId,
        parsed.projectPath,
        'afterHash',
        parsed.afterHash,
        'afterByteLength',
        parsed.afterByteLength,
      );
    }

    this.database.prepare(`
      INSERT INTO workspace_changed_files (
        changed_file_id,
        change_set_id,
        workspace_checkpoint_id,
        session_id,
        run_id,
        step_id,
        tool_call_id,
        tool_execution_id,
        source_entry_id,
        response_message_id,
        project_path,
        change_kind,
        restore_state,
        before_exists,
        before_content_ref_id,
        before_hash,
        before_byte_length,
        after_exists,
        after_content_ref_id,
        after_hash,
        after_byte_length,
        created_at,
        updated_at,
        metadata_json
      ) VALUES (
        @changed_file_id,
        @change_set_id,
        @workspace_checkpoint_id,
        @session_id,
        @run_id,
        @step_id,
        @tool_call_id,
        @tool_execution_id,
        @source_entry_id,
        @response_message_id,
        @project_path,
        @change_kind,
        @restore_state,
        @before_exists,
        @before_content_ref_id,
        @before_hash,
        @before_byte_length,
        @after_exists,
        @after_content_ref_id,
        @after_hash,
        @after_byte_length,
        @created_at,
        @updated_at,
        @metadata_json
      )
    `).run(changedFileParams(parsed));
    return parsed;
  }

  getChangedFile(changedFileId: string): WorkspaceChangedFile | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_changed_files
      WHERE changed_file_id = ?
    `).get(changedFileId) as WorkspaceChangedFileRow | undefined;
    return row ? changedFileFromRow(row) : undefined;
  }

  listChangedFilesByChangeSet(changeSetId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_changed_files
      WHERE change_set_id = ?
      ORDER BY created_at ASC, changed_file_id ASC
    `).all(changeSetId) as WorkspaceChangedFileRow[]).map(changedFileFromRow);
  }

  listChangedFilesByRun(runId: string): WorkspaceChangedFile[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_changed_files
      WHERE run_id = ?
      ORDER BY created_at ASC, changed_file_id ASC
    `).all(runId) as WorkspaceChangedFileRow[]).map(changedFileFromRow);
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
      SET restore_state = @restore_state,
        updated_at = @updated_at,
        metadata_json = @metadata_json
      WHERE changed_file_id = @changed_file_id
    `).run({
      changed_file_id: parsed.changedFileId,
      restore_state: parsed.restoreState,
      updated_at: parsed.updatedAt,
      metadata_json: stringifyOptionalJson(parsed.metadata),
    });
    return this.getChangedFile(parsed.changedFileId);
  }

  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined {
    const changeSet = this.getChangeSet(changeSetId);
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
      WHERE change_set_id = ?
    `).get(changeSetId) as ChangeSummaryCountRow;

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
    return this.listChangeSetsByRun(runId)
      .map((changeSet) => this.getChangeSummary(changeSet.changeSetId))
      .filter((summary): summary is WorkspaceChangeSummary => Boolean(summary));
  }

  saveRestoreRequest(request: WorkspaceRestoreRequest): WorkspaceRestoreRequest {
    const parsed = WorkspaceRestoreRequestSchema.parse(request);
    const existing = this.getRestoreRequest(parsed.restoreRequestId);
    if (existing) {
      assertDurableRecordMatches('Restore request', parsed.restoreRequestId, existing, parsed);
      return parsed;
    }

    const changeSet = this.getChangeSet(parsed.changeSetId);
    if (!changeSet) {
      throw new Error(`Cannot save restore request without change set: ${parsed.changeSetId}`);
    }
    assertSameSessionRun({
      subject: 'Restore request',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'change set',
      referenceSessionId: changeSet.sessionId,
      referenceRunId: changeSet.runId,
    });
    assertRunBelongsToSession(this.database, 'Restore request', parsed.runId, parsed.sessionId);

    this.database.prepare(`
      INSERT INTO workspace_restore_requests (
        restore_request_id,
        change_set_id,
        session_id,
        run_id,
        requested_by,
        status,
        requested_at,
        completed_at,
        metadata_json
      ) VALUES (
        @restore_request_id,
        @change_set_id,
        @session_id,
        @run_id,
        @requested_by,
        @status,
        @requested_at,
        @completed_at,
        @metadata_json
      )
    `).run(restoreRequestParams(parsed));
    return parsed;
  }

  getRestoreRequest(restoreRequestId: string): WorkspaceRestoreRequest | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_restore_requests
      WHERE restore_request_id = ?
    `).get(restoreRequestId) as WorkspaceRestoreRequestRow | undefined;
    return row ? restoreRequestFromRow(row) : undefined;
  }

  updateRestoreRequestStatus(input: {
    restoreRequestId: string;
    status: WorkspaceRestoreRequest['status'];
    completedAt?: string;
    metadata?: WorkspaceRestoreRequest['metadata'];
  }): WorkspaceRestoreRequest | undefined {
    const existing = this.getRestoreRequest(input.restoreRequestId);
    if (!existing) {
      return undefined;
    }
    const parsed = WorkspaceRestoreRequestSchema.parse({
      ...existing,
      status: input.status,
      completedAt: input.completedAt,
      metadata: input.metadata,
    });
    this.database.prepare(`
      UPDATE workspace_restore_requests
      SET status = @status,
        completed_at = @completed_at,
        metadata_json = @metadata_json
      WHERE restore_request_id = @restore_request_id
    `).run({
      restore_request_id: parsed.restoreRequestId,
      status: parsed.status,
      completed_at: parsed.completedAt ?? null,
      metadata_json: stringifyOptionalJson(parsed.metadata),
    });
    return this.getRestoreRequest(parsed.restoreRequestId);
  }

  saveRestoreResult(result: WorkspaceRestoreResult): WorkspaceRestoreResult {
    const parsed = WorkspaceRestoreResultSchema.parse(result);
    const existing = this.getRestoreResult(parsed.restoreResultId);
    if (existing) {
      assertDurableRecordMatches('Restore result', parsed.restoreResultId, existing, parsed);
      return parsed;
    }

    const request = this.getRestoreRequest(parsed.restoreRequestId);
    if (!request) {
      throw new Error(`Cannot save restore result without restore request: ${parsed.restoreRequestId}`);
    }
    if (parsed.changeSetId !== request.changeSetId) {
      throw new Error(
        `Restore result changeSetId ${parsed.changeSetId} does not match request changeSetId ${request.changeSetId}`,
      );
    }
    assertSameSessionRun({
      subject: 'Restore result',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'request',
      referenceSessionId: request.sessionId,
      referenceRunId: request.runId,
    });

    const changeSet = this.getChangeSet(parsed.changeSetId);
    if (!changeSet) {
      throw new Error(`Cannot save restore result without change set: ${parsed.changeSetId}`);
    }
    assertSameSessionRun({
      subject: 'Restore result',
      subjectSessionId: parsed.sessionId,
      subjectRunId: parsed.runId,
      referenceName: 'change set',
      referenceSessionId: changeSet.sessionId,
      referenceRunId: changeSet.runId,
    });
    assertRunBelongsToSession(this.database, 'Restore result', parsed.runId, parsed.sessionId);

    this.database.prepare(`
      INSERT INTO workspace_restore_results (
        restore_result_id,
        restore_request_id,
        change_set_id,
        session_id,
        run_id,
        status,
        restored_at,
        error_json,
        metadata_json
      ) VALUES (
        @restore_result_id,
        @restore_request_id,
        @change_set_id,
        @session_id,
        @run_id,
        @status,
        @restored_at,
        @error_json,
        @metadata_json
      )
    `).run(restoreResultParams(parsed));
    return parsed;
  }

  getRestoreResult(restoreResultId: string): WorkspaceRestoreResult | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_restore_results
      WHERE restore_result_id = ?
    `).get(restoreResultId) as WorkspaceRestoreResultRow | undefined;
    return row ? restoreResultFromRow(row) : undefined;
  }

  listRestoreResultsByChangeSet(changeSetId: string): WorkspaceRestoreResult[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_restore_results
      WHERE change_set_id = ?
      ORDER BY restored_at ASC, restore_result_id ASC
    `).all(changeSetId) as WorkspaceRestoreResultRow[]).map(restoreResultFromRow);
  }

  saveRestoreFileResult(fileResult: WorkspaceRestoreFileResult): WorkspaceRestoreFileResult {
    const parsed = WorkspaceRestoreFileResultSchema.parse(fileResult);
    const existing = this.getRestoreFileResult(parsed.restoreFileResultId);
    if (existing) {
      assertDurableRecordMatches(
        'Restore file result',
        parsed.restoreFileResultId,
        existing,
        parsed,
      );
      return parsed;
    }

    const result = this.getRestoreResult(parsed.restoreResultId);
    if (!result) {
      throw new Error(`Cannot save restore file result without restore result: ${parsed.restoreResultId}`);
    }
    const changedFile = this.getChangedFile(parsed.changedFileId);
    if (!changedFile) {
      throw new Error(`Cannot save restore file result without changed file: ${parsed.changedFileId}`);
    }
    if (changedFile.changeSetId !== result.changeSetId) {
      throw new Error(
        `Restore file result changedFileId ${parsed.changedFileId} belongs to changeSetId ${changedFile.changeSetId}, not ${result.changeSetId}`,
      );
    }
    if (changedFile.sessionId !== result.sessionId) {
      throw new Error(
        `Restore file result changedFileId ${parsed.changedFileId} belongs to sessionId ${changedFile.sessionId}, not ${result.sessionId}`,
      );
    }
    if (changedFile.runId !== result.runId) {
      throw new Error(
        `Restore file result changedFileId ${parsed.changedFileId} belongs to runId ${changedFile.runId}, not ${result.runId}`,
      );
    }
    if (parsed.projectPath !== changedFile.projectPath) {
      throw new Error(
        `Restore file result projectPath ${parsed.projectPath} does not match changed file projectPath ${changedFile.projectPath}`,
      );
    }

    this.database.prepare(`
      INSERT INTO workspace_restore_file_results (
        restore_file_result_id,
        restore_result_id,
        changed_file_id,
        project_path,
        status,
        conflict_reason,
        error_json,
        restored_at,
        metadata_json
      ) VALUES (
        @restore_file_result_id,
        @restore_result_id,
        @changed_file_id,
        @project_path,
        @status,
        @conflict_reason,
        @error_json,
        @restored_at,
        @metadata_json
      )
    `).run(restoreFileResultParams(parsed));
    return parsed;
  }

  private getRestoreFileResult(restoreFileResultId: string): WorkspaceRestoreFileResult | undefined {
    const row = this.database.prepare(`
      SELECT *
      FROM workspace_restore_file_results
      WHERE restore_file_result_id = ?
    `).get(restoreFileResultId) as WorkspaceRestoreFileResultRow | undefined;
    return row ? restoreFileResultFromRow(row) : undefined;
  }

  listRestoreFileResultsByResult(restoreResultId: string): WorkspaceRestoreFileResult[] {
    return (this.database.prepare(`
      SELECT *
      FROM workspace_restore_file_results
      WHERE restore_result_id = ?
      ORDER BY restored_at ASC, restore_file_result_id ASC
    `).all(restoreResultId) as WorkspaceRestoreFileResultRow[]).map(restoreFileResultFromRow);
  }
}

function snapshotContentFromRow(row: WorkspaceSnapshotContentRow): WorkspaceSnapshotContent {
  return WorkspaceSnapshotContentSchema.parse({
    contentRefId: row.content_ref_id,
    sessionId: row.session_id,
    runId: row.run_id,
    projectPath: row.project_path,
    storage: row.storage,
    encoding: row.encoding,
    sha256: row.sha256,
    byteLength: row.byte_length,
    contentText: row.content_text,
    createdAt: row.created_at,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function changeSetFromRow(row: WorkspaceChangeSetRow): WorkspaceChangeSet {
  return WorkspaceChangeSetSchema.parse({
    changeSetId: row.change_set_id,
    sessionId: row.session_id,
    runId: row.run_id,
    stepId: optionalString(row.step_id),
    sourceEntryId: optionalString(row.source_entry_id),
    responseMessageId: optionalString(row.response_message_id),
    status: row.status,
    changedFileCount: row.changed_file_count,
    createdAt: row.created_at,
    finalizedAt: optionalString(row.finalized_at),
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function checkpointFromRow(row: WorkspaceCheckpointRow): WorkspaceCheckpoint {
  return WorkspaceCheckpointSchema.parse({
    workspaceCheckpointId: row.workspace_checkpoint_id,
    sessionId: row.session_id,
    runId: row.run_id,
    stepId: optionalString(row.step_id),
    toolCallId: optionalString(row.tool_call_id),
    toolExecutionId: optionalString(row.tool_execution_id),
    sourceEntryId: optionalString(row.source_entry_id),
    responseMessageId: optionalString(row.response_message_id),
    changeSetId: optionalString(row.change_set_id),
    projectPath: row.project_path,
    beforeExists: Boolean(row.before_exists),
    beforeContentRefId: optionalString(row.before_content_ref_id),
    beforeHash: optionalString(row.before_hash),
    beforeByteLength: optionalNumber(row.before_byte_length),
    createdAt: row.created_at,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function changedFileFromRow(row: WorkspaceChangedFileRow): WorkspaceChangedFile {
  return WorkspaceChangedFileSchema.parse({
    changedFileId: row.changed_file_id,
    changeSetId: row.change_set_id,
    workspaceCheckpointId: row.workspace_checkpoint_id,
    sessionId: row.session_id,
    runId: row.run_id,
    stepId: optionalString(row.step_id),
    toolCallId: optionalString(row.tool_call_id),
    toolExecutionId: optionalString(row.tool_execution_id),
    sourceEntryId: optionalString(row.source_entry_id),
    responseMessageId: optionalString(row.response_message_id),
    projectPath: row.project_path,
    changeKind: row.change_kind,
    restoreState: row.restore_state,
    beforeExists: Boolean(row.before_exists),
    beforeContentRefId: optionalString(row.before_content_ref_id),
    beforeHash: optionalString(row.before_hash),
    beforeByteLength: optionalNumber(row.before_byte_length),
    afterExists: Boolean(row.after_exists),
    afterContentRefId: optionalString(row.after_content_ref_id),
    afterHash: optionalString(row.after_hash),
    afterByteLength: optionalNumber(row.after_byte_length),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function restoreRequestFromRow(row: WorkspaceRestoreRequestRow): WorkspaceRestoreRequest {
  return WorkspaceRestoreRequestSchema.parse({
    restoreRequestId: row.restore_request_id,
    changeSetId: row.change_set_id,
    sessionId: row.session_id,
    runId: row.run_id,
    requestedBy: row.requested_by,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: optionalString(row.completed_at),
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function restoreResultFromRow(row: WorkspaceRestoreResultRow): WorkspaceRestoreResult {
  return WorkspaceRestoreResultSchema.parse({
    restoreResultId: row.restore_result_id,
    restoreRequestId: row.restore_request_id,
    changeSetId: row.change_set_id,
    sessionId: row.session_id,
    runId: row.run_id,
    status: row.status,
    restoredAt: row.restored_at,
    error: parseOptionalJson(row.error_json) as RuntimeError | undefined,
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function restoreFileResultFromRow(row: WorkspaceRestoreFileResultRow): WorkspaceRestoreFileResult {
  return WorkspaceRestoreFileResultSchema.parse({
    restoreFileResultId: row.restore_file_result_id,
    restoreResultId: row.restore_result_id,
    changedFileId: row.changed_file_id,
    projectPath: row.project_path,
    status: row.status,
    conflictReason: optionalString(row.conflict_reason),
    error: parseOptionalJson(row.error_json) as RuntimeError | undefined,
    restoredAt: optionalString(row.restored_at),
    metadata: parseOptionalJson(row.metadata_json),
  });
}

function changeSetParams(changeSet: WorkspaceChangeSet): Record<string, unknown> {
  return {
    change_set_id: changeSet.changeSetId,
    session_id: changeSet.sessionId,
    run_id: changeSet.runId,
    step_id: changeSet.stepId ?? null,
    source_entry_id: changeSet.sourceEntryId ?? null,
    response_message_id: changeSet.responseMessageId ?? null,
    status: changeSet.status,
    changed_file_count: changeSet.changedFileCount,
    created_at: changeSet.createdAt,
    finalized_at: changeSet.finalizedAt ?? null,
    metadata_json: stringifyOptionalJson(changeSet.metadata),
  };
}

function checkpointParams(checkpoint: WorkspaceCheckpoint): Record<string, unknown> {
  return {
    workspace_checkpoint_id: checkpoint.workspaceCheckpointId,
    change_set_id: checkpoint.changeSetId ?? null,
    session_id: checkpoint.sessionId,
    run_id: checkpoint.runId,
    step_id: checkpoint.stepId ?? null,
    tool_call_id: checkpoint.toolCallId ?? null,
    tool_execution_id: checkpoint.toolExecutionId ?? null,
    source_entry_id: checkpoint.sourceEntryId ?? null,
    response_message_id: checkpoint.responseMessageId ?? null,
    project_path: checkpoint.projectPath,
    before_exists: checkpoint.beforeExists ? 1 : 0,
    before_content_ref_id: checkpoint.beforeContentRefId ?? null,
    before_hash: checkpoint.beforeHash ?? null,
    before_byte_length: checkpoint.beforeByteLength ?? null,
    created_at: checkpoint.createdAt,
    metadata_json: stringifyOptionalJson(checkpoint.metadata),
  };
}

function changedFileParams(changedFile: WorkspaceChangedFile): Record<string, unknown> {
  return {
    changed_file_id: changedFile.changedFileId,
    change_set_id: changedFile.changeSetId,
    workspace_checkpoint_id: changedFile.workspaceCheckpointId,
    session_id: changedFile.sessionId,
    run_id: changedFile.runId,
    step_id: changedFile.stepId ?? null,
    tool_call_id: changedFile.toolCallId ?? null,
    tool_execution_id: changedFile.toolExecutionId ?? null,
    source_entry_id: changedFile.sourceEntryId ?? null,
    response_message_id: changedFile.responseMessageId ?? null,
    project_path: changedFile.projectPath,
    change_kind: changedFile.changeKind,
    restore_state: changedFile.restoreState,
    before_exists: changedFile.beforeExists ? 1 : 0,
    before_content_ref_id: changedFile.beforeContentRefId ?? null,
    before_hash: changedFile.beforeHash ?? null,
    before_byte_length: changedFile.beforeByteLength ?? null,
    after_exists: changedFile.afterExists ? 1 : 0,
    after_content_ref_id: changedFile.afterContentRefId ?? null,
    after_hash: changedFile.afterHash ?? null,
    after_byte_length: changedFile.afterByteLength ?? null,
    created_at: changedFile.createdAt,
    updated_at: changedFile.updatedAt,
    metadata_json: stringifyOptionalJson(changedFile.metadata),
  };
}

function restoreRequestParams(request: WorkspaceRestoreRequest): Record<string, unknown> {
  return {
    restore_request_id: request.restoreRequestId,
    change_set_id: request.changeSetId,
    session_id: request.sessionId,
    run_id: request.runId,
    requested_by: request.requestedBy,
    status: request.status,
    requested_at: request.requestedAt,
    completed_at: request.completedAt ?? null,
    metadata_json: stringifyOptionalJson(request.metadata),
  };
}

function restoreResultParams(result: WorkspaceRestoreResult): Record<string, unknown> {
  return {
    restore_result_id: result.restoreResultId,
    restore_request_id: result.restoreRequestId,
    change_set_id: result.changeSetId,
    session_id: result.sessionId,
    run_id: result.runId,
    status: result.status,
    restored_at: result.restoredAt,
    error_json: stringifyOptionalJson(result.error),
    metadata_json: stringifyOptionalJson(result.metadata),
  };
}

function restoreFileResultParams(fileResult: WorkspaceRestoreFileResult): Record<string, unknown> {
  return {
    restore_file_result_id: fileResult.restoreFileResultId,
    restore_result_id: fileResult.restoreResultId,
    changed_file_id: fileResult.changedFileId,
    project_path: fileResult.projectPath,
    status: fileResult.status,
    conflict_reason: fileResult.conflictReason ?? null,
    error_json: stringifyOptionalJson(fileResult.error),
    restored_at: fileResult.restoredAt ?? null,
    metadata_json: stringifyOptionalJson(fileResult.metadata),
  };
}

function countChangedFiles(database: MegumiDatabase, changeSetId: string): number {
  return (database.prepare(`
    SELECT COUNT(*) AS count
    FROM workspace_changed_files
    WHERE change_set_id = ?
  `).get(changeSetId) as { count: number }).count;
}

function assertSnapshotDurableFieldsMatch(
  existing: WorkspaceSnapshotContent,
  next: WorkspaceSnapshotContent,
): void {
  const durableFields: Array<keyof WorkspaceSnapshotContent> = [
    'sessionId',
    'runId',
    'projectPath',
    'storage',
    'encoding',
    'sha256',
    'byteLength',
    'contentText',
    'createdAt',
  ];
  const hasDifference = durableFields.some((field) => existing[field] !== next[field]);
  if (hasDifference) {
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
    throw new Error(
      `Snapshot content ${content.contentRefId} byteLength does not match contentText UTF-8 byte length`,
    );
  }
}

function assertDurableRecordMatches<T>(
  subject: string,
  id: string,
  existing: T,
  next: T,
): void {
  if (!isDeepEqual(existing, next)) {
    throw new Error(`${subject} ${id} already exists with different durable fields`);
  }
}

function assertSnapshotContentRefBelongsToOwner(
  database: MegumiDatabase,
  subject: string,
  fieldName: string,
  contentRefId: string,
  sessionId: string,
  runId: string,
  projectPath: string,
  hashFieldName: string,
  expectedHash: string | undefined,
  byteLengthFieldName: string,
  expectedByteLength: number | undefined,
): void {
  const row = database.prepare(`
    SELECT session_id, run_id, project_path, sha256, byte_length
    FROM workspace_snapshot_contents
    WHERE content_ref_id = ?
  `).get(contentRefId) as {
    session_id: string;
    run_id: string;
    project_path: string;
    sha256: string;
    byte_length: number;
  } | undefined;
  if (!row) {
    throw new Error(`${subject} ${fieldName} ${contentRefId} does not exist`);
  }
  if (row.session_id !== sessionId || row.run_id !== runId || row.project_path !== projectPath) {
    throw new Error(
      `${subject} ${fieldName} ${contentRefId} belongs to sessionId ${row.session_id}/runId ${row.run_id}/projectPath ${row.project_path}, not sessionId ${sessionId}/runId ${runId}/projectPath ${projectPath}`,
    );
  }
  if (expectedHash !== undefined && row.sha256 !== expectedHash) {
    throw new Error(`${subject} ${fieldName} ${contentRefId} sha256 ${row.sha256} does not match ${hashFieldName} ${expectedHash}`);
  }
  if (expectedByteLength !== undefined && row.byte_length !== expectedByteLength) {
    throw new Error(`${subject} ${fieldName} ${contentRefId} byteLength ${row.byte_length} does not match ${byteLengthFieldName} ${expectedByteLength}`);
  }
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isDeepEqual(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined);
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  leftKeys.sort();
  rightKeys.sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => (
    key === rightKeys[index]
    && Object.prototype.hasOwnProperty.call(rightRecord, key)
    && isDeepEqual(leftRecord[key], rightRecord[key])
  ));
}

function validateOptionalLifecycleRefs(
  database: MegumiDatabase,
  subject: string,
  input: {
    sessionId: string;
    runId: string;
    stepId?: string;
    sourceEntryId?: string;
    responseMessageId?: string;
  },
): void {
  if (input.stepId) {
    assertStepBelongsToRun(database, subject, input.stepId, input.runId);
  }
  if (input.sourceEntryId) {
    assertSourceEntryBelongsToSession(database, subject, input.sourceEntryId, input.sessionId);
  }
  if (input.responseMessageId) {
    assertMessageBelongsToSession(database, subject, input.responseMessageId, input.sessionId);
  }
}

function assertRunBelongsToSession(
  database: MegumiDatabase,
  subject: string,
  runId: string,
  sessionId: string,
): void {
  const row = database.prepare(`
    SELECT session_id
    FROM runs
    WHERE run_id = ?
  `).get(runId) as { session_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} runId ${runId} does not exist`);
  }
  if (row.session_id !== sessionId) {
    throw new Error(`${subject} runId ${runId} does not belong to sessionId ${sessionId}`);
  }
}

function assertStepBelongsToRun(
  database: MegumiDatabase,
  subject: string,
  stepId: string,
  runId: string,
): void {
  const row = database.prepare(`
    SELECT run_id
    FROM run_steps
    WHERE step_id = ?
  `).get(stepId) as { run_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} stepId ${stepId} does not exist`);
  }
  if (row.run_id !== runId) {
    throw new Error(`${subject} stepId ${stepId} does not belong to runId ${runId}`);
  }
}

function assertSourceEntryBelongsToSession(
  database: MegumiDatabase,
  subject: string,
  sourceEntryId: string,
  sessionId: string,
): void {
  const row = database.prepare(`
    SELECT session_id
    FROM session_source_entries
    WHERE source_entry_id = ?
  `).get(sourceEntryId) as { session_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} sourceEntryId ${sourceEntryId} does not exist`);
  }
  if (row.session_id !== sessionId) {
    throw new Error(`${subject} sourceEntryId ${sourceEntryId} does not belong to sessionId ${sessionId}`);
  }
}

function assertMessageBelongsToSession(
  database: MegumiDatabase,
  subject: string,
  messageId: string,
  sessionId: string,
): void {
  const row = database.prepare(`
    SELECT session_id
    FROM session_messages
    WHERE message_id = ?
  `).get(messageId) as { session_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} responseMessageId ${messageId} does not exist`);
  }
  if (row.session_id !== sessionId) {
    throw new Error(`${subject} responseMessageId ${messageId} does not belong to sessionId ${sessionId}`);
  }
}

function assertToolCallBelongsToRun(
  database: MegumiDatabase,
  subject: string,
  toolCallId: string,
  runId: string,
): void {
  const row = database.prepare(`
    SELECT run_id
    FROM tool_calls
    WHERE tool_call_id = ?
  `).get(toolCallId) as { run_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} toolCallId ${toolCallId} does not exist`);
  }
  if (row.run_id !== runId) {
    throw new Error(`${subject} toolCallId ${toolCallId} does not belong to runId ${runId}`);
  }
}

function assertToolExecutionBelongsToRun(
  database: MegumiDatabase,
  subject: string,
  toolExecutionId: string,
  runId: string,
): void {
  const row = database.prepare(`
    SELECT run_id
    FROM tool_executions
    WHERE tool_execution_id = ?
  `).get(toolExecutionId) as { run_id: string } | undefined;
  if (!row) {
    throw new Error(`${subject} toolExecutionId ${toolExecutionId} does not exist`);
  }
  if (row.run_id !== runId) {
    throw new Error(`${subject} toolExecutionId ${toolExecutionId} does not belong to runId ${runId}`);
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
  if (!input.inverseMessage) {
    if (input.subjectSessionId !== input.referenceSessionId) {
      throw new Error(
        `${input.subject} sessionId ${input.subjectSessionId} does not match ${input.referenceName} sessionId ${input.referenceSessionId}`,
      );
    }
    if (input.subjectRunId !== input.referenceRunId) {
      throw new Error(
        `${input.subject} runId ${input.subjectRunId} does not match ${input.referenceName} runId ${input.referenceRunId}`,
      );
    }
    return;
  }

  if (input.subjectSessionId !== input.referenceSessionId) {
    throw new Error(
      `${input.subject} belongs to sessionId ${input.subjectSessionId}, not ${input.referenceSessionId}`,
    );
  }
  if (input.subjectRunId !== input.referenceRunId) {
    throw new Error(`${input.subject} belongs to runId ${input.subjectRunId}, not ${input.referenceRunId}`);
  }
}

function optionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined;
}

function optionalNumber(value: number | null): number | undefined {
  return value ?? undefined;
}

function parseOptionalJson(value: string | null): unknown | undefined {
  return value ? JSON.parse(value) : undefined;
}

function stringifyOptionalJson(value: unknown | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

