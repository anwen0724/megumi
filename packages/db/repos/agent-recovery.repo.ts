import type {
  AgentCancelRequest,
  AgentCheckpoint,
  AgentResumeRequest,
  AgentRetryRequest,
  CheckpointRestoreRecord,
  CheckpointStatus,
} from '@megumi/shared/agent-recovery-contracts';
import type { MegumiDatabase } from '../connection';

interface CheckpointRow { checkpoint_json: string }
interface ResumeRequestRow { request_json: string }
interface CancelRequestRow { request_json: string }
interface RetryRequestRow { request_json: string }
interface RestoreRecordRow { restore_record_json: string }

export class AgentRecoveryRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveCheckpoint(checkpoint: AgentCheckpoint): AgentCheckpoint {
    this.database.prepare(`
      INSERT INTO agent_checkpoints (
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

  getCheckpoint(checkpointId: string): AgentCheckpoint | undefined {
    const row = this.database.prepare('SELECT checkpoint_json FROM agent_checkpoints WHERE checkpoint_id = ?').get(checkpointId) as CheckpointRow | undefined;
    return row ? JSON.parse(row.checkpoint_json) as AgentCheckpoint : undefined;
  }

  listCheckpointsByRun(runId: string): AgentCheckpoint[] {
    return (this.database.prepare('SELECT checkpoint_json FROM agent_checkpoints WHERE run_id = ? ORDER BY sequence ASC').all(runId) as CheckpointRow[])
      .map((row) => JSON.parse(row.checkpoint_json) as AgentCheckpoint);
  }

  getLatestCheckpointByRun(runId: string): AgentCheckpoint | undefined {
    const row = this.database.prepare('SELECT checkpoint_json FROM agent_checkpoints WHERE run_id = ? ORDER BY sequence DESC LIMIT 1').get(runId) as CheckpointRow | undefined;
    return row ? JSON.parse(row.checkpoint_json) as AgentCheckpoint : undefined;
  }

  markCheckpointStatus(checkpointId: string, status: CheckpointStatus): void {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return;
    }
    this.saveCheckpoint({ ...checkpoint, status });
  }

  saveResumeRequest(request: AgentResumeRequest): AgentResumeRequest {
    this.database.prepare(`
      INSERT INTO agent_resume_requests (
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

  listResumeRequestsByRun(runId: string): AgentResumeRequest[] {
    return (this.database.prepare('SELECT request_json FROM agent_resume_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as ResumeRequestRow[])
      .map((row) => JSON.parse(row.request_json) as AgentResumeRequest);
  }

  saveCancelRequest(request: AgentCancelRequest): AgentCancelRequest {
    this.database.prepare(`
      INSERT INTO agent_cancel_requests (
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

  listCancelRequestsByRun(runId: string): AgentCancelRequest[] {
    return (this.database.prepare('SELECT request_json FROM agent_cancel_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as CancelRequestRow[])
      .map((row) => JSON.parse(row.request_json) as AgentCancelRequest);
  }

  saveRetryRequest(request: AgentRetryRequest): AgentRetryRequest {
    this.database.prepare(`
      INSERT INTO agent_retry_requests (
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

  listRetryRequestsByRun(runId: string): AgentRetryRequest[] {
    return (this.database.prepare('SELECT request_json FROM agent_retry_requests WHERE run_id = ? ORDER BY created_at ASC').all(runId) as RetryRequestRow[])
      .map((row) => JSON.parse(row.request_json) as AgentRetryRequest);
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
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
