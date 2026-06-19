// Implements permission-owned repository ports while keeping policy rules in the permission module.
import {
  isPermissionRecordReusable,
  resolveApprovalRequest as resolveApprovalDomainRequest,
  type ApprovalRecord,
  type ApprovalRequest,
  type PermissionOperation,
  type PermissionRecord,
  type PermissionRepository,
  type PermissionSnapshot,
  type PolicyDecision,
  type UserDecision,
} from '../../permission';
import type { SqliteDatabase } from '../connection';
import { decodeJsonField } from '../json';

interface JsonRow {
  id: string;
  value_json: string;
}

export class SqlitePermissionRepository implements PermissionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async savePermissionSnapshot(snapshot: PermissionSnapshot): Promise<void> {
    this.database.prepare(`
      INSERT INTO permission_snapshots (id, run_id, session_id, mode, mode_source, created_at, snapshot_json)
      VALUES (@id, @runId, @sessionId, @mode, @modeSource, @createdAt, @snapshotJson)
      ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json
    `).run({
      id: snapshot.id,
      runId: snapshot.runId,
      sessionId: snapshot.sessionId,
      mode: snapshot.mode,
      modeSource: snapshot.modeSource,
      createdAt: snapshot.createdAt,
      snapshotJson: JSON.stringify(snapshot),
    });
  }

  async getPermissionSnapshot(id: string): Promise<PermissionSnapshot | undefined> {
    const row = this.database.prepare('SELECT id, snapshot_json AS value_json FROM permission_snapshots WHERE id = ?').get(id) as
      | JsonRow
      | undefined;
    return row ? mapJson<PermissionSnapshot>(row, 'permission_snapshots') : undefined;
  }

  async savePolicyDecision(id: string, decision: PolicyDecision): Promise<void> {
    this.database.prepare(`
      INSERT INTO permission_policy_decisions (
        id, decision_kind, operation, target, command, mode, risk_level, created_at, decision_json
      ) VALUES (
        @id, @decisionKind, @operation, @target, @command, @mode, @riskLevel, @createdAt, @decisionJson
      )
      ON CONFLICT(id) DO UPDATE SET decision_json = excluded.decision_json
    `).run({
      id,
      decisionKind: decision.kind,
      operation: decision.operation,
      target: decision.target ?? null,
      command: decision.command ?? null,
      mode: decision.mode,
      riskLevel: decision.risk.level,
      createdAt: decision.createdAt,
      decisionJson: JSON.stringify(decision),
    });
  }

  async getPolicyDecision(id: string): Promise<PolicyDecision | undefined> {
    const row = this.database
      .prepare('SELECT id, decision_json AS value_json FROM permission_policy_decisions WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? mapJson<PolicyDecision>(row, 'permission_policy_decisions') : undefined;
  }

  async saveApprovalRequest(request: ApprovalRequest): Promise<void> {
    this.database.prepare(`
      INSERT INTO permission_approval_requests (
        id, run_id, session_id, tool_call_id, tool_execution_id, status, policy_decision_id,
        created_at, resolved_at, request_json
      ) VALUES (
        @id, @runId, @sessionId, @toolCallId, @toolExecutionId, @status, @policyDecisionId,
        @createdAt, @resolvedAt, @requestJson
      )
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        resolved_at = excluded.resolved_at,
        request_json = excluded.request_json
    `).run({
      id: request.id,
      runId: request.runId ?? null,
      sessionId: request.sessionId ?? null,
      toolCallId: request.toolCallId,
      toolExecutionId: request.toolExecutionId ?? null,
      status: request.status,
      policyDecisionId: request.policyDecision.id,
      createdAt: request.createdAt,
      resolvedAt: request.resolvedAt ?? null,
      requestJson: JSON.stringify(request),
    });
  }

  async getApprovalRequest(id: string): Promise<ApprovalRequest | undefined> {
    const row = this.database
      .prepare('SELECT id, request_json AS value_json FROM permission_approval_requests WHERE id = ?')
      .get(id) as JsonRow | undefined;
    return row ? mapJson<ApprovalRequest>(row, 'permission_approval_requests') : undefined;
  }

  async resolveApprovalRequest(id: string, decision: UserDecision): Promise<ApprovalRequest> {
    const approval = await this.getApprovalRequest(id);
    if (!approval) {
      throw new Error(`Approval request not found: ${id}`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`Approval request is already resolved: ${id}`);
    }
    const resolved = resolveApprovalDomainRequest({ approval, userDecision: decision });
    await this.saveApprovalRequest(resolved);
    return resolved;
  }

  async saveApprovalRecord(record: ApprovalRecord): Promise<void> {
    this.database.prepare(`
      INSERT INTO permission_approval_records (
        id, approval_request_id, run_id, session_id, tool_call_id, scope, resolved_at, record_json
      ) VALUES (
        @id, @approvalRequestId, @runId, @sessionId, @toolCallId, @scope, @resolvedAt, @recordJson
      )
      ON CONFLICT(id) DO UPDATE SET record_json = excluded.record_json
    `).run({
      id: record.id,
      approvalRequestId: record.approvalRequestId,
      runId: record.runId ?? null,
      sessionId: record.sessionId ?? null,
      toolCallId: record.toolCallId,
      scope: record.scope,
      resolvedAt: record.resolvedAt,
      recordJson: JSON.stringify(record),
    });
  }

  async listApprovalRecords(input: { toolCallId?: string; sessionId?: string; runId?: string }): Promise<ApprovalRecord[]> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (input.toolCallId) {
      clauses.push('tool_call_id = @toolCallId');
      params.toolCallId = input.toolCallId;
    }
    if (input.sessionId) {
      clauses.push('session_id = @sessionId');
      params.sessionId = input.sessionId;
    }
    if (input.runId) {
      clauses.push('run_id = @runId');
      params.runId = input.runId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database
      .prepare(`SELECT id, record_json AS value_json FROM permission_approval_records ${where} ORDER BY resolved_at ASC`)
      .all(params) as JsonRow[]).map((row) => mapJson<ApprovalRecord>(row, 'permission_approval_records'));
  }

  async savePermissionRecord(record: PermissionRecord): Promise<void> {
    this.database.prepare(`
      INSERT INTO permission_records (
        id, operation, target, scope, session_id, run_id, source_approval_request_id,
        created_at, expires_at, record_json
      ) VALUES (
        @id, @operation, @target, @scope, @sessionId, @runId, @sourceApprovalRequestId,
        @createdAt, @expiresAt, @recordJson
      )
      ON CONFLICT(id) DO UPDATE SET
        expires_at = excluded.expires_at,
        record_json = excluded.record_json
    `).run({
      id: record.id,
      operation: record.operation,
      target: record.target,
      scope: record.scope,
      sessionId: record.sessionId ?? null,
      runId: record.runId ?? null,
      sourceApprovalRequestId: record.sourceApprovalRequestId ?? null,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt ?? null,
      recordJson: JSON.stringify(record),
    });
  }

  async listPermissionRecords(input: { operation?: string; target?: string; sessionId?: string }): Promise<PermissionRecord[]> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (input.operation) {
      clauses.push('operation = @operation');
      params.operation = input.operation;
    }
    if (input.target) {
      clauses.push('target = @target');
      params.target = input.target;
    }
    if (input.sessionId) {
      clauses.push('session_id = @sessionId');
      params.sessionId = input.sessionId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database
      .prepare(`SELECT id, record_json AS value_json FROM permission_records ${where} ORDER BY created_at ASC`)
      .all(params) as JsonRow[]).map((row) => mapJson<PermissionRecord>(row, 'permission_records'));
  }

  async findReusablePermissionRecord(input: {
    operation: PermissionOperation;
    target: string;
    sessionId?: string;
    now: string;
  }): Promise<PermissionRecord | undefined> {
    const records = await this.listPermissionRecords({
      operation: input.operation,
      target: input.target,
      sessionId: input.sessionId,
    });
    return records.find((record) => isPermissionRecordReusable(record, input));
  }

  async expirePermissionRecord(id: string, expiresAt: string): Promise<void> {
    const row = this.database.prepare('SELECT id, record_json AS value_json FROM permission_records WHERE id = ?').get(id) as
      | JsonRow
      | undefined;
    if (!row) return;
    const record = { ...mapJson<PermissionRecord>(row, 'permission_records'), expiresAt };
    await this.savePermissionRecord(record);
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
