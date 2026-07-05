/*
 * Agent Run module repository for its owned business tables.
 * Persistence provides the database; Agent Run owns these read/write rules.
 */
import type { MegumiDatabase } from '../../persistence/connection';
import type { AgentRun, AgentRunApprovalRequest, AgentRunFailure } from '../contracts/agent-run-contracts';

export type AgentRunRepository = {
  createRun(run: AgentRun): AgentRun;
  getRun(runId: string): AgentRun | undefined;
  saveRun(run: AgentRun): AgentRun;
  listRunsBySession(sessionId: string): AgentRun[];
  listInterruptedRuns(): AgentRun[];
  createApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest;
  getApprovalRequest(approvalRequestId: string): AgentRunApprovalRequest | undefined;
  saveApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest;
  listPendingApprovalRequestsByRun(runId: string): AgentRunApprovalRequest[];
};

export type CreateAgentRunRepositoryOptions = {
  database: MegumiDatabase;
};

type AgentRunRow = {
  run_id: string;
  workspace_id: string;
  session_id: string;
  provider_id: string;
  model_id: string;
  trigger_type: string;
  trigger_user_message_id: string | null;
  trigger_command_name: string | null;
  status: AgentRun['status'];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  failure_json: string | null;
};

type AgentRunApprovalRequestRow = {
  approval_request_id: string;
  run_id: string;
  subject_json: string;
  status: AgentRunApprovalRequest['status'];
  created_at: string;
  decided_at: string | null;
  decision_json: string | null;
};

export function createAgentRunRepository(options: CreateAgentRunRepositoryOptions): AgentRunRepository {
  return new SqliteAgentRunRepository(options.database);
}

class SqliteAgentRunRepository implements AgentRunRepository {
  constructor(private readonly database: MegumiDatabase) {}

  createRun(run: AgentRun): AgentRun {
    const row = rowFromRun(run);
    this.database.prepare(`
      INSERT INTO agent_runs (
        run_id,
        workspace_id,
        session_id,
        provider_id,
        model_id,
        trigger_type,
        trigger_user_message_id,
        trigger_command_name,
        status,
        created_at,
        started_at,
        completed_at,
        failure_json
      ) VALUES (
        @run_id,
        @workspace_id,
        @session_id,
        @provider_id,
        @model_id,
        @trigger_type,
        @trigger_user_message_id,
        @trigger_command_name,
        @status,
        @created_at,
        @started_at,
        @completed_at,
        @failure_json
      )
    `).run(row);
    return run;
  }

  getRun(runId: string): AgentRun | undefined {
    const row = this.database.prepare('SELECT * FROM agent_runs WHERE run_id = ?')
      .get(runId) as AgentRunRow | undefined;
    return row ? runFromRow(row) : undefined;
  }

  saveRun(run: AgentRun): AgentRun {
    const row = rowFromRun(run);
    this.database.prepare(`
      UPDATE agent_runs
      SET
        workspace_id = @workspace_id,
        session_id = @session_id,
        provider_id = @provider_id,
        model_id = @model_id,
        trigger_type = @trigger_type,
        trigger_user_message_id = @trigger_user_message_id,
        trigger_command_name = @trigger_command_name,
        status = @status,
        created_at = @created_at,
        started_at = @started_at,
        completed_at = @completed_at,
        failure_json = @failure_json
      WHERE run_id = @run_id
    `).run(row);
    return run;
  }

  listRunsBySession(sessionId: string): AgentRun[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_runs
      WHERE session_id = ?
      ORDER BY created_at ASC, run_id ASC
    `).all(sessionId) as AgentRunRow[];
    return rows.map(runFromRow);
  }

  listInterruptedRuns(): AgentRun[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_runs
      WHERE status IN ('running', 'waiting_for_approval', 'cancelling')
      ORDER BY created_at ASC, run_id ASC
    `).all() as AgentRunRow[];
    return rows.map(runFromRow);
  }

  createApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest {
    this.database.prepare(`
      INSERT INTO agent_run_approval_requests (
        approval_request_id,
        run_id,
        subject_json,
        status,
        created_at,
        decided_at,
        decision_json
      ) VALUES (
        @approval_request_id,
        @run_id,
        @subject_json,
        @status,
        @created_at,
        @decided_at,
        @decision_json
      )
    `).run(rowFromApprovalRequest(request));
    return request;
  }

  getApprovalRequest(approvalRequestId: string): AgentRunApprovalRequest | undefined {
    const row = this.database.prepare(`
      SELECT * FROM agent_run_approval_requests
      WHERE approval_request_id = ?
    `).get(approvalRequestId) as AgentRunApprovalRequestRow | undefined;
    return row ? approvalRequestFromRow(row) : undefined;
  }

  saveApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest {
    this.database.prepare(`
      UPDATE agent_run_approval_requests
      SET
        run_id = @run_id,
        subject_json = @subject_json,
        status = @status,
        created_at = @created_at,
        decided_at = @decided_at,
        decision_json = @decision_json
      WHERE approval_request_id = @approval_request_id
    `).run(rowFromApprovalRequest(request));
    return request;
  }

  listPendingApprovalRequestsByRun(runId: string): AgentRunApprovalRequest[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_run_approval_requests
      WHERE run_id = ? AND status = 'pending'
      ORDER BY created_at ASC, approval_request_id ASC
    `).all(runId) as AgentRunApprovalRequestRow[];
    return rows.map(approvalRequestFromRow);
  }
}

function rowFromRun(run: AgentRun): AgentRunRow {
  return {
    run_id: run.run_id,
    workspace_id: run.workspace_id,
    session_id: run.session_id,
    provider_id: run.model_selection.provider_id,
    model_id: run.model_selection.model_id,
    trigger_type: run.trigger.type,
    trigger_user_message_id: run.trigger.type === 'user_input'
      ? run.trigger.user_message_id
      : run.trigger.user_message_id ?? null,
    trigger_command_name: run.trigger.type === 'command' ? run.trigger.command_name : null,
    status: run.status,
    created_at: run.created_at,
    started_at: run.started_at ?? null,
    completed_at: run.completed_at ?? null,
    failure_json: run.failure ? JSON.stringify(run.failure) : null,
  };
}

function runFromRow(row: AgentRunRow): AgentRun {
  return {
    run_id: row.run_id,
    workspace_id: row.workspace_id,
    session_id: row.session_id,
    model_selection: {
      provider_id: row.provider_id,
      model_id: row.model_id,
    },
    trigger: row.trigger_type === 'command'
      ? {
          type: 'command',
          command_name: row.trigger_command_name ?? '',
          ...(row.trigger_user_message_id ? { user_message_id: row.trigger_user_message_id } : {}),
        }
      : {
          type: 'user_input',
          user_message_id: row.trigger_user_message_id ?? '',
        },
    status: row.status,
    created_at: row.created_at,
    ...(row.started_at ? { started_at: row.started_at } : {}),
    ...(row.completed_at ? { completed_at: row.completed_at } : {}),
    ...(row.failure_json ? { failure: parseJson<AgentRunFailure>(row.failure_json) } : {}),
  };
}

function rowFromApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequestRow {
  return {
    approval_request_id: request.approval_request_id,
    run_id: request.run_id,
    subject_json: JSON.stringify(request.subject),
    status: request.status,
    created_at: request.created_at,
    decided_at: request.decided_at ?? null,
    decision_json: request.decision ? JSON.stringify(request.decision) : null,
  };
}

function approvalRequestFromRow(row: AgentRunApprovalRequestRow): AgentRunApprovalRequest {
  return {
    approval_request_id: row.approval_request_id,
    run_id: row.run_id,
    subject: parseJson<AgentRunApprovalRequest['subject']>(row.subject_json),
    status: row.status,
    created_at: row.created_at,
    ...(row.decided_at ? { decided_at: row.decided_at } : {}),
    ...(row.decision_json ? { decision: parseJson<AgentRunApprovalRequest['decision']>(row.decision_json) } : {}),
  };
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}
