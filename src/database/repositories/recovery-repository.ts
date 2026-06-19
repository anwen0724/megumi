// Persists recovery control requests and derives recoverable runs from session run facts.
import type { JsonObject } from '../../shared';
import type { SessionStateRepository } from '../../session';
import type { SqliteDatabase } from '../connection';
import { encodeJson } from '../json';

export type RecoveryRunStatus = 'waiting_for_approval' | 'failed' | 'cancelled' | 'running' | 'queued';
export type RecoveryRunReason = 'waiting_for_approval' | 'failed' | 'cancelled' | 'interrupted' | 'cancelling';

export interface RecoveryCancelRequestRecord {
  cancelRequestId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  reason: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface RecoveryRetryRequestRecord {
  retryRequestId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  retryKind: 'manual_retry' | 'manual_rerun';
  reason: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface RecoveryResumeRequestRecord {
  resumeRequestId: string;
  runId: string;
  sessionId?: string;
  workspaceId?: string;
  approvalRequestId?: string;
  decision?: 'approve' | 'deny';
  createdAt: string;
  metadata?: JsonObject;
}

export interface RecoverableRunRecord {
  runId: string;
  sessionId: string;
  status: RecoveryRunStatus;
  reason: RecoveryRunReason;
  title?: string;
  preview?: string;
  workspaceId?: string;
  metadata?: JsonObject;
}

interface RequestRow {
  request_json: string;
}

export class SqliteRecoveryRepository {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly sessions: SessionStateRepository,
  ) {}

  saveCancelRequest(request: RecoveryCancelRequestRecord): RecoveryCancelRequestRecord {
    this.database.prepare(`
      INSERT INTO recovery_cancel_requests (
        id, run_id, session_id, workspace_id, reason, created_at, metadata_json, request_json
      ) VALUES (
        @id, @runId, @sessionId, @workspaceId, @reason, @createdAt, @metadataJson, @requestJson
      )
      ON CONFLICT(id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      id: request.cancelRequestId,
      runId: request.runId,
      sessionId: request.sessionId ?? null,
      workspaceId: request.workspaceId ?? null,
      reason: request.reason,
      createdAt: request.createdAt,
      metadataJson: encodeJson(request.metadata),
      requestJson: JSON.stringify(request),
    });
    return request;
  }

  saveRetryRequest(request: RecoveryRetryRequestRecord): RecoveryRetryRequestRecord {
    this.database.prepare(`
      INSERT INTO recovery_retry_requests (
        id, run_id, session_id, workspace_id, retry_kind, reason, created_at, metadata_json, request_json
      ) VALUES (
        @id, @runId, @sessionId, @workspaceId, @retryKind, @reason, @createdAt, @metadataJson, @requestJson
      )
      ON CONFLICT(id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      id: request.retryRequestId,
      runId: request.runId,
      sessionId: request.sessionId ?? null,
      workspaceId: request.workspaceId ?? null,
      retryKind: request.retryKind,
      reason: request.reason,
      createdAt: request.createdAt,
      metadataJson: encodeJson(request.metadata),
      requestJson: JSON.stringify(request),
    });
    return request;
  }

  saveResumeRequest(request: RecoveryResumeRequestRecord): RecoveryResumeRequestRecord {
    this.database.prepare(`
      INSERT INTO recovery_resume_requests (
        id, run_id, session_id, workspace_id, approval_request_id, decision, created_at, metadata_json, request_json
      ) VALUES (
        @id, @runId, @sessionId, @workspaceId, @approvalRequestId, @decision, @createdAt, @metadataJson, @requestJson
      )
      ON CONFLICT(id) DO UPDATE SET request_json = excluded.request_json
    `).run({
      id: request.resumeRequestId,
      runId: request.runId,
      sessionId: request.sessionId ?? null,
      workspaceId: request.workspaceId ?? null,
      approvalRequestId: request.approvalRequestId ?? null,
      decision: request.decision ?? null,
      createdAt: request.createdAt,
      metadataJson: encodeJson(request.metadata),
      requestJson: JSON.stringify(request),
    });
    return request;
  }

  listCancelRequestsByRun(runId: string): RecoveryCancelRequestRecord[] {
    return (this.database
      .prepare('SELECT request_json FROM recovery_cancel_requests WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as RequestRow[]).map((row) => JSON.parse(row.request_json) as RecoveryCancelRequestRecord);
  }

  listRetryRequestsByRun(runId: string): RecoveryRetryRequestRecord[] {
    return (this.database
      .prepare('SELECT request_json FROM recovery_retry_requests WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as RequestRow[]).map((row) => JSON.parse(row.request_json) as RecoveryRetryRequestRecord);
  }

  listResumeRequestsByRun(runId: string): RecoveryResumeRequestRecord[] {
    return (this.database
      .prepare('SELECT request_json FROM recovery_resume_requests WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId) as RequestRow[]).map((row) => JSON.parse(row.request_json) as RecoveryResumeRequestRecord);
  }

  listRecoverableRuns(): RecoverableRunRecord[] {
    return this.sessions.listSessions().flatMap((session) => this.sessions
      .listRunRecords(session.id)
      .filter((run) => isRecoverableStatus(run.status))
      .map((run): RecoverableRunRecord => ({
        runId: run.id,
        sessionId: run.sessionId,
        status: run.status as RecoveryRunStatus,
        reason: recoverableReason(run.status),
        title: session.title,
        preview: run.inputSummary,
        ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
        ...(run.metadata ? { metadata: run.metadata } : {}),
      })));
  }
}

function isRecoverableStatus(status: string): status is RecoveryRunStatus {
  return status === 'waiting_for_approval' || status === 'failed' || status === 'cancelled' || status === 'running' || status === 'queued';
}

function recoverableReason(status: RecoveryRunStatus): RecoveryRunReason {
  if (status === 'waiting_for_approval') return 'waiting_for_approval';
  if (status === 'running' || status === 'queued') return 'interrupted';
  return status;
}
