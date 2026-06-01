import type {
  CancelRequest,
  Checkpoint,
  RecoverableRunSummary,
  RecoverableRunReason,
  ResumeRequest,
  RetryRequest,
  CheckpointRestoreRecord,
  CheckpointStatus,
} from '@megumi/shared/recovery-contracts';
import {
  RecoverableRunSummarySchema,
} from '@megumi/shared/recovery-contracts';
import {
  SessionInterruptedRunMarkerSchema,
  type SessionInterruptedRunMarker,
  type SessionInterruptedRunPreviousStatus,
  type SessionInterruptedRunReason,
} from '@megumi/shared/session-active-path-contracts';
import type { MegumiDatabase } from '../connection';

interface CheckpointRow { checkpoint_json: string }
interface ResumeRequestRow { request_json: string }
interface CancelRequestRow { request_json: string }
interface RetryRequestRow { request_json: string }
interface RestoreRecordRow { restore_record_json: string }
interface RecoverableRunRow {
  run_id: string;
  session_id: string;
  status: RecoverableRunSummary['status'];
  goal: string;
  title: string;
  latest_checkpoint_id: string | null;
  latest_checkpoint_at: string | null;
  interrupted_marker_id: string | null;
}
interface InterruptibleRunRow {
  run_id: string;
  session_id: string;
  status: SessionInterruptedRunPreviousStatus;
}

const RECOVERABLE_RUN_STATUSES = [
  'waiting_for_approval',
  'paused',
  'failed',
  'cancelled',
  'queued',
  'running',
  'cancelling',
] as const;

const RUNNING_LIKE_STATUSES = ['queued', 'running', 'cancelling'] as const;

export class RecoveryRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveCheckpoint(checkpoint: Checkpoint): Checkpoint {
    this.database.prepare(`
      INSERT INTO checkpoints (
        checkpoint_id, run_id, step_id, action_id, reason, status, boundary,
        sequence, schema_version, created_at, created_by, mode_snapshot_ref,
        context_build_ref, policy_snapshot_ref, tool_registry_snapshot_ref,
        approval_request_id, tool_call_id, parent_checkpoint_id,
        side_effect_refs_json, resume_cursor, state_summary, state_ref,
        metadata_json, checkpoint_json
      ) VALUES (
        @checkpoint_id, @run_id, @step_id, @action_id, @reason, @status, @boundary,
        @sequence, @schema_version, @created_at, @created_by, @mode_snapshot_ref,
        @context_build_ref, @policy_snapshot_ref, @tool_registry_snapshot_ref,
        @approval_request_id, @tool_call_id, @parent_checkpoint_id,
        @side_effect_refs_json, @resume_cursor, @state_summary, @state_ref,
        @metadata_json, @checkpoint_json
      )
      ON CONFLICT(checkpoint_id) DO UPDATE SET
        status = excluded.status,
        metadata_json = excluded.metadata_json,
        checkpoint_json = excluded.checkpoint_json
    `).run({
      checkpoint_id: checkpoint.checkpointId,
      run_id: checkpoint.runId,
      step_id: checkpoint.stepId ?? null,
      action_id: checkpoint.actionId ?? null,
      reason: checkpoint.reason,
      status: checkpoint.status,
      boundary: checkpoint.boundary,
      sequence: checkpoint.sequence,
      schema_version: checkpoint.schemaVersion,
      created_at: checkpoint.createdAt,
      created_by: checkpoint.createdBy,
      mode_snapshot_ref: checkpoint.modeSnapshotRef ?? null,
      context_build_ref: checkpoint.contextBuildRef ?? null,
      policy_snapshot_ref: checkpoint.policySnapshotRef ?? null,
      tool_registry_snapshot_ref: checkpoint.toolRegistrySnapshotRef ?? null,
      approval_request_id: checkpoint.approvalRequestId ?? null,
      tool_call_id: checkpoint.toolCallId ?? null,
      parent_checkpoint_id: checkpoint.parentCheckpointId ?? null,
      side_effect_refs_json: stringifyJson(checkpoint.sideEffectRefs),
      resume_cursor: checkpoint.resumeCursor ?? null,
      state_summary: checkpoint.stateSummary,
      state_ref: checkpoint.stateRef ?? null,
      metadata_json: checkpoint.metadata ? stringifyJson(checkpoint.metadata) : null,
      checkpoint_json: stringifyJson(checkpoint),
    });
    return checkpoint;
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    const row = this.database.prepare('SELECT checkpoint_json FROM checkpoints WHERE checkpoint_id = ?').get(checkpointId) as CheckpointRow | undefined;
    return row ? JSON.parse(row.checkpoint_json) as Checkpoint : undefined;
  }

  listCheckpointsByRun(runId: string): Checkpoint[] {
    return (this.database.prepare('SELECT checkpoint_json FROM checkpoints WHERE run_id = ? ORDER BY sequence ASC').all(runId) as CheckpointRow[])
      .map((row) => JSON.parse(row.checkpoint_json) as Checkpoint);
  }

  getLatestCheckpointByRun(runId: string): Checkpoint | undefined {
    const row = this.database.prepare('SELECT checkpoint_json FROM checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT 1').get(runId) as CheckpointRow | undefined;
    return row ? JSON.parse(row.checkpoint_json) as Checkpoint : undefined;
  }

  markCheckpointStatus(checkpointId: string, status: CheckpointStatus): void {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return;
    }
    this.saveCheckpoint({ ...checkpoint, status });
  }

  saveResumeRequest(request: ResumeRequest): ResumeRequest {
    this.database.prepare(`
      INSERT INTO resume_requests (
        resume_request_id, run_id, checkpoint_id, requested_by, reason,
        resume_mode, created_at, metadata_json, request_json
      ) VALUES (
        @resume_request_id, @run_id, @checkpoint_id, @requested_by, @reason,
        @resume_mode, @created_at, @metadata_json, @request_json
      )
      ON CONFLICT(resume_request_id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      resume_request_id: request.resumeRequestId,
      run_id: request.runId,
      checkpoint_id: request.checkpointId ?? null,
      requested_by: request.requestedBy,
      reason: request.reason,
      resume_mode: request.resumeMode,
      created_at: request.createdAt,
      metadata_json: request.metadata ? stringifyJson(request.metadata) : null,
      request_json: stringifyJson(request),
    });
    return request;
  }

  listResumeRequestsByRun(runId: string): ResumeRequest[] {
    return (this.database.prepare('SELECT request_json FROM resume_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as ResumeRequestRow[])
      .map((row) => JSON.parse(row.request_json) as ResumeRequest);
  }

  saveCancelRequest(request: CancelRequest): CancelRequest {
    this.database.prepare(`
      INSERT INTO cancel_requests (
        cancel_request_id, run_id, step_id, action_id, requested_by,
        reason, scope, created_at, metadata_json, request_json
      ) VALUES (
        @cancel_request_id, @run_id, @step_id, @action_id, @requested_by,
        @reason, @scope, @created_at, @metadata_json, @request_json
      )
      ON CONFLICT(cancel_request_id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      cancel_request_id: request.cancelRequestId,
      run_id: request.runId,
      step_id: request.stepId ?? null,
      action_id: request.actionId ?? null,
      requested_by: request.requestedBy,
      reason: request.reason,
      scope: request.scope,
      created_at: request.createdAt,
      metadata_json: request.metadata ? stringifyJson(request.metadata) : null,
      request_json: stringifyJson(request),
    });
    return request;
  }

  listCancelRequestsByRun(runId: string): CancelRequest[] {
    return (this.database.prepare('SELECT request_json FROM cancel_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as CancelRequestRow[])
      .map((row) => JSON.parse(row.request_json) as CancelRequest);
  }

  saveRetryRequest(request: RetryRequest): RetryRequest {
    this.database.prepare(`
      INSERT INTO retry_requests (
        retry_request_id, run_id, step_id, action_id, checkpoint_id, requested_by,
        retry_kind, reason, created_at, metadata_json, request_json
      ) VALUES (
        @retry_request_id, @run_id, @step_id, @action_id, @checkpoint_id, @requested_by,
        @retry_kind, @reason, @created_at, @metadata_json, @request_json
      )
      ON CONFLICT(retry_request_id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      retry_request_id: request.retryRequestId,
      run_id: request.runId,
      step_id: request.stepId ?? null,
      action_id: request.actionId ?? null,
      checkpoint_id: request.checkpointId ?? null,
      requested_by: request.requestedBy,
      retry_kind: request.retryKind,
      reason: request.reason,
      created_at: request.createdAt,
      metadata_json: request.metadata ? stringifyJson(request.metadata) : null,
      request_json: stringifyJson(request),
    });
    return request;
  }

  listRetryRequestsByRun(runId: string): RetryRequest[] {
    return (this.database.prepare('SELECT request_json FROM retry_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as RetryRequestRow[])
      .map((row) => JSON.parse(row.request_json) as RetryRequest);
  }

  saveRestoreRecord(record: CheckpointRestoreRecord): CheckpointRestoreRecord {
    this.database.prepare(`
      INSERT INTO checkpoint_restore_records (
        restore_record_id, run_id, checkpoint_id, resume_request_id, status,
        restored_at, error_json, metadata_json, restore_record_json
      ) VALUES (
        @restore_record_id, @run_id, @checkpoint_id, @resume_request_id, @status,
        @restored_at, @error_json, @metadata_json, @restore_record_json
      )
      ON CONFLICT(restore_record_id) DO UPDATE SET restore_record_json = excluded.restore_record_json
    `).run({
      restore_record_id: record.restoreRecordId,
      run_id: record.runId,
      checkpoint_id: record.checkpointId,
      resume_request_id: record.resumeRequestId ?? null,
      status: record.status,
      restored_at: record.restoredAt,
      error_json: record.error ? stringifyJson(record.error) : null,
      metadata_json: record.metadata ? stringifyJson(record.metadata) : null,
      restore_record_json: stringifyJson(record),
    });
    return record;
  }

  listRestoreRecordsByRun(runId: string): CheckpointRestoreRecord[] {
    return (this.database.prepare('SELECT restore_record_json FROM checkpoint_restore_records WHERE run_id = ? ORDER BY restored_at ASC').all(runId) as RestoreRecordRow[])
      .map((row) => JSON.parse(row.restore_record_json) as CheckpointRestoreRecord);
  }

  listRecoverableRuns(): RecoverableRunSummary[] {
    return (this.database.prepare(`
      SELECT
        runs.run_id,
        runs.session_id,
        runs.status,
        runs.goal,
        sessions.title,
        latest_checkpoint.checkpoint_id AS latest_checkpoint_id,
        latest_checkpoint.created_at AS latest_checkpoint_at,
        latest_marker.interrupted_marker_id AS interrupted_marker_id
      FROM runs
      INNER JOIN sessions ON sessions.session_id = runs.session_id
      LEFT JOIN checkpoints AS latest_checkpoint
        ON latest_checkpoint.checkpoint_id = (
          SELECT checkpoint_id
          FROM checkpoints
          WHERE run_id = runs.run_id
          ORDER BY sequence DESC, created_at DESC, checkpoint_id DESC
          LIMIT 1
        )
      LEFT JOIN session_interrupted_run_markers AS latest_marker
        ON latest_marker.interrupted_marker_id = (
          SELECT interrupted_marker_id
          FROM session_interrupted_run_markers
          WHERE run_id = runs.run_id
          ORDER BY marked_at DESC, interrupted_marker_id DESC
          LIMIT 1
        )
      WHERE runs.status IN (${RECOVERABLE_RUN_STATUSES.map(() => '?').join(', ')})
      ORDER BY runs.created_at ASC, runs.run_id ASC
    `).all(...RECOVERABLE_RUN_STATUSES) as RecoverableRunRow[])
      .map((row) => RecoverableRunSummarySchema.parse({
        runId: row.run_id,
        sessionId: row.session_id,
        status: row.status,
        reason: recoverableReasonFor(row.status, row.interrupted_marker_id),
        ...(row.latest_checkpoint_id ? { latestCheckpointId: row.latest_checkpoint_id } : {}),
        ...(row.latest_checkpoint_at ? { latestCheckpointAt: row.latest_checkpoint_at } : {}),
        ...(row.title ? { title: row.title } : {}),
        ...(row.goal ? { preview: row.goal.slice(0, 240) } : {}),
        ...(row.interrupted_marker_id ? { metadata: { interruptedMarkerId: row.interrupted_marker_id } } : {}),
      }));
  }

  markInterruptedRuns(input: {
    markedAt: string;
    reason: SessionInterruptedRunReason;
    createMarkerId(runId: string): string;
  }): SessionInterruptedRunMarker[] {
    const mark = this.database.transaction(() => {
      const rows = this.database.prepare(`
        SELECT run_id, session_id, status
        FROM runs
        WHERE status IN (${RUNNING_LIKE_STATUSES.map(() => '?').join(', ')})
          AND NOT EXISTS (
            SELECT 1
            FROM session_interrupted_run_markers markers
            WHERE markers.run_id = runs.run_id
          )
        ORDER BY created_at ASC, run_id ASC
      `).all(...RUNNING_LIKE_STATUSES) as InterruptibleRunRow[];

      const markers = rows.map((row) => SessionInterruptedRunMarkerSchema.parse({
        interruptedMarkerId: input.createMarkerId(row.run_id),
        sessionId: row.session_id,
        runId: row.run_id,
        previousStatus: row.status,
        reason: input.reason,
        markedAt: input.markedAt,
      }));

      for (const marker of markers) {
        this.database.prepare(`
          INSERT INTO session_interrupted_run_markers (
            interrupted_marker_id,
            session_id,
            run_id,
            previous_status,
            reason,
            marked_at,
            metadata_json,
            marker_json
          ) VALUES (
            @interrupted_marker_id,
            @session_id,
            @run_id,
            @previous_status,
            @reason,
            @marked_at,
            @metadata_json,
            @marker_json
          )
        `).run({
          interrupted_marker_id: marker.interruptedMarkerId,
          session_id: marker.sessionId,
          run_id: marker.runId,
          previous_status: marker.previousStatus,
          reason: marker.reason,
          marked_at: marker.markedAt,
          metadata_json: marker.metadata ? stringifyJson(marker.metadata) : null,
          marker_json: stringifyJson(marker),
        });
      }

      return markers;
    });

    return mark();
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function recoverableReasonFor(
  status: RecoverableRunSummary['status'],
  interruptedMarkerId: string | null,
): RecoverableRunReason {
  if (interruptedMarkerId || RUNNING_LIKE_STATUSES.includes(status as SessionInterruptedRunPreviousStatus)) {
    return 'interrupted';
  }
  return status as RecoverableRunReason;
}
