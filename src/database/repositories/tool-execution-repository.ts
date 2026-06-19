// Implements tools-owned execution and audit repository ports with SQLite query columns.
import type { ToolAuditRecord, ToolExecution } from '../../tools';
import type { SqliteDatabase } from '../connection';
import { decodeJsonField, encodeJson } from '../json';

interface ToolExecutionRow {
  id: string;
  execution_json: string;
}

interface ToolAuditRecordRow {
  id: string;
  audit_json: string;
}

type ToolExecutionFilter = { runId?: string; toolCallId?: string };

export class SqliteToolExecutionRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async createExecution(execution: ToolExecution): Promise<void> {
    this.upsertExecution(execution);
  }

  async updateExecution(execution: ToolExecution): Promise<void> {
    this.upsertExecution(execution);
  }

  async getExecution(id: string): Promise<ToolExecution | undefined> {
    const row = this.database.prepare('SELECT id, execution_json FROM tool_executions WHERE id = ?').get(id) as
      | ToolExecutionRow
      | undefined;
    return row ? mapToolExecution(row) : undefined;
  }

  async listExecutions(input: ToolExecutionFilter = {}): Promise<ToolExecution[]> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (input.runId) {
      clauses.push('run_id = @runId');
      params.runId = input.runId;
    }
    if (input.toolCallId) {
      clauses.push('tool_call_id = @toolCallId');
      params.toolCallId = input.toolCallId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database
      .prepare(`SELECT id, execution_json FROM tool_executions ${where} ORDER BY started_at ASC, id ASC`)
      .all(params) as ToolExecutionRow[]).map(mapToolExecution);
  }

  async saveAuditRecord(record: ToolAuditRecord): Promise<void> {
    const value = record as ToolAuditRecord & { runId?: string; sessionId?: string; workspaceId?: string };
    this.database.prepare(`
      INSERT INTO tool_audit_records (
        id, tool_call_id, tool_name, status, run_id, session_id, workspace_id, created_at,
        error_json, decision_json, audit_json
      ) VALUES (
        @id, @toolCallId, @toolName, @status, @runId, @sessionId, @workspaceId, @createdAt,
        @errorJson, @decisionJson, @auditJson
      )
    `).run({
      id: record.id,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      status: record.status,
      runId: value.runId ?? null,
      sessionId: value.sessionId ?? null,
      workspaceId: value.workspaceId ?? null,
      createdAt: record.createdAt,
      errorJson: encodeJson(record.error),
      decisionJson: encodeJson(record.decision),
      auditJson: JSON.stringify(record),
    });
  }

  async listAuditRecords(input: ToolExecutionFilter = {}): Promise<ToolAuditRecord[]> {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (input.runId) {
      clauses.push('run_id = @runId');
      params.runId = input.runId;
    }
    if (input.toolCallId) {
      clauses.push('tool_call_id = @toolCallId');
      params.toolCallId = input.toolCallId;
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return (this.database
      .prepare(`SELECT id, audit_json FROM tool_audit_records ${where} ORDER BY created_at ASC, id ASC`)
      .all(params) as ToolAuditRecordRow[]).map(mapToolAuditRecord);
  }

  private upsertExecution(execution: ToolExecution): void {
    const value = execution as ToolExecution & {
      runId?: string;
      sessionId?: string;
      workspaceId?: string;
      turnIndex?: number;
      workspaceChangeSetId?: string;
    };
    this.database.prepare(`
      INSERT INTO tool_executions (
        id, tool_call_id, tool_name, status, run_id, session_id, workspace_id, turn_index,
        started_at, ended_at, workspace_change_set_id, execution_json
      ) VALUES (
        @id, @toolCallId, @toolName, @status, @runId, @sessionId, @workspaceId, @turnIndex,
        @startedAt, @endedAt, @workspaceChangeSetId, @executionJson
      )
      ON CONFLICT(id) DO UPDATE SET
        tool_call_id = excluded.tool_call_id,
        tool_name = excluded.tool_name,
        status = excluded.status,
        run_id = excluded.run_id,
        session_id = excluded.session_id,
        workspace_id = excluded.workspace_id,
        turn_index = excluded.turn_index,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        workspace_change_set_id = excluded.workspace_change_set_id,
        execution_json = excluded.execution_json
    `).run({
      id: execution.id,
      toolCallId: execution.toolCallId,
      toolName: execution.toolName,
      status: execution.status,
      runId: value.runId ?? null,
      sessionId: value.sessionId ?? null,
      workspaceId: value.workspaceId ?? null,
      turnIndex: value.turnIndex ?? null,
      startedAt: execution.startedAt ?? null,
      endedAt: execution.endedAt ?? null,
      workspaceChangeSetId: value.workspaceChangeSetId ?? null,
      executionJson: JSON.stringify(execution),
    });
  }
}

function mapToolExecution(row: ToolExecutionRow): ToolExecution {
  return decodeJsonField<ToolExecution>({
    value: row.execution_json,
    table: 'tool_executions',
    column: 'execution_json',
    rowId: row.id,
  }) as ToolExecution;
}

function mapToolAuditRecord(row: ToolAuditRecordRow): ToolAuditRecord {
  return decodeJsonField<ToolAuditRecord>({
    value: row.audit_json,
    table: 'tool_audit_records',
    column: 'audit_json',
    rowId: row.id,
  }) as ToolAuditRecord;
}
