import type { MegumiDatabase } from '../connection';
import type {
  ApprovalRecord,
  ApprovalRequest,
  ToolCall,
  ToolObservation,
  ToolPolicyDecision,
} from '@megumi/shared/tool-contracts';

interface ToolCallRow { tool_call_json: string }
interface PolicyDecisionRow { decision_json: string }
interface ApprovalRequestRow { request_json: string }
interface ToolObservationRow { observation_json: string }

export class ToolRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveToolCall(toolCall: ToolCall): ToolCall {
    this.database.prepare(`
      INSERT INTO tool_calls (
        tool_call_id, run_id, step_id, action_id, tool_name, input_preview_json,
        capabilities_json, risk_level, side_effect, status, requested_at,
        started_at, completed_at, error_json, metadata_json, tool_call_json
      ) VALUES (
        @tool_call_id, @run_id, @step_id, @action_id, @tool_name, @input_preview_json,
        @capabilities_json, @risk_level, @side_effect, @status, @requested_at,
        @started_at, @completed_at, @error_json, @metadata_json, @tool_call_json
      )
      ON CONFLICT(tool_call_id) DO UPDATE SET
        status = excluded.status,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        tool_call_json = excluded.tool_call_json
    `).run({
      tool_call_id: toolCall.toolCallId,
      run_id: toolCall.runId,
      step_id: toolCall.stepId,
      action_id: toolCall.actionId,
      tool_name: toolCall.toolName,
      input_preview_json: stringifyJson(toolCall.inputPreview),
      capabilities_json: stringifyJson(toolCall.capabilities),
      risk_level: toolCall.riskLevel,
      side_effect: toolCall.sideEffect,
      status: toolCall.status,
      requested_at: toolCall.requestedAt,
      started_at: toolCall.startedAt ?? null,
      completed_at: toolCall.completedAt ?? null,
      error_json: toolCall.error ? stringifyJson(toolCall.error) : null,
      metadata_json: toolCall.metadata ? stringifyJson(toolCall.metadata) : null,
      tool_call_json: stringifyJson(toolCall),
    });
    return toolCall;
  }

  getToolCall(toolCallId: string): ToolCall | undefined {
    const row = this.database.prepare('SELECT tool_call_json FROM tool_calls WHERE tool_call_id = ?').get(toolCallId) as ToolCallRow | undefined;
    return row ? JSON.parse(row.tool_call_json) as ToolCall : undefined;
  }

  listToolCallsByRun(runId: string): ToolCall[] {
    return (this.database.prepare('SELECT tool_call_json FROM tool_calls WHERE run_id = ? ORDER BY requested_at ASC').all(runId) as ToolCallRow[])
      .map((row) => JSON.parse(row.tool_call_json) as ToolCall);
  }

  savePolicyDecision(policyDecisionId: string, runId: string, toolCallId: string, decision: ToolPolicyDecision): ToolPolicyDecision {
    this.database.prepare(`
      INSERT INTO tool_policy_decisions (
        policy_decision_id, tool_call_id, run_id, decision, effective_risk_level,
        reason, required_approval_json, required_sandbox_json, evaluated_at,
        metadata_json, decision_json
      ) VALUES (
        @policy_decision_id, @tool_call_id, @run_id, @decision, @effective_risk_level,
        @reason, @required_approval_json, @required_sandbox_json, @evaluated_at,
        @metadata_json, @decision_json
      )
    `).run({
      policy_decision_id: policyDecisionId,
      tool_call_id: toolCallId,
      run_id: runId,
      decision: decision.decision,
      effective_risk_level: decision.effectiveRiskLevel,
      reason: decision.reason,
      required_approval_json: decision.requiredApproval ? stringifyJson(decision.requiredApproval) : null,
      required_sandbox_json: decision.requiredSandbox ? stringifyJson(decision.requiredSandbox) : null,
      evaluated_at: decision.evaluatedAt,
      metadata_json: decision.metadata ? stringifyJson(decision.metadata) : null,
      decision_json: stringifyJson(decision),
    });
    return decision;
  }

  listPolicyDecisionsByToolCall(toolCallId: string): ToolPolicyDecision[] {
    return (this.database.prepare('SELECT decision_json FROM tool_policy_decisions WHERE tool_call_id = ? ORDER BY evaluated_at ASC').all(toolCallId) as PolicyDecisionRow[])
      .map((row) => JSON.parse(row.decision_json) as ToolPolicyDecision);
  }

  saveApprovalRequest(request: ApprovalRequest): ApprovalRequest {
    this.database.prepare(`
      INSERT INTO approval_requests (
        approval_request_id, tool_call_id, run_id, step_id, tool_name, status,
        requested_scope, risk_level, created_at, expires_at, resolved_at, request_json
      ) VALUES (
        @approval_request_id, @tool_call_id, @run_id, @step_id, @tool_name, @status,
        @requested_scope, @risk_level, @created_at, @expires_at, @resolved_at, @request_json
      )
      ON CONFLICT(approval_request_id) DO UPDATE SET
        status = excluded.status,
        resolved_at = excluded.resolved_at,
        request_json = excluded.request_json
    `).run({
      approval_request_id: request.approvalRequestId,
      tool_call_id: request.toolCallId,
      run_id: request.runId,
      step_id: request.stepId,
      tool_name: request.toolName,
      status: request.status,
      requested_scope: request.requestedScope,
      risk_level: request.riskLevel,
      created_at: request.createdAt,
      expires_at: request.expiresAt ?? null,
      resolved_at: request.resolvedAt ?? null,
      request_json: stringifyJson(request),
    });
    return request;
  }

  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined {
    const row = this.database.prepare('SELECT request_json FROM approval_requests WHERE approval_request_id = ?').get(approvalRequestId) as ApprovalRequestRow | undefined;
    return row ? JSON.parse(row.request_json) as ApprovalRequest : undefined;
  }

  saveApprovalRecord(record: ApprovalRecord): ApprovalRecord {
    this.database.prepare(`
      INSERT INTO approval_records (
        approval_record_id, approval_request_id, tool_call_id, run_id, step_id,
        decision, scope, decided_by, decided_at, record_json
      ) VALUES (
        @approval_record_id, @approval_request_id, @tool_call_id, @run_id, @step_id,
        @decision, @scope, @decided_by, @decided_at, @record_json
      )
    `).run({
      approval_record_id: record.approvalRecordId,
      approval_request_id: record.approvalRequestId,
      tool_call_id: record.toolCallId,
      run_id: record.runId,
      step_id: record.stepId,
      decision: record.decision,
      scope: record.scope,
      decided_by: record.decidedBy,
      decided_at: record.decidedAt,
      record_json: stringifyJson(record),
    });
    return record;
  }

  saveToolObservation(observation: ToolObservation): ToolObservation {
    this.database.prepare(`
      INSERT INTO tool_observations (
        observation_id, tool_call_id, run_id, step_id, status, summary,
        text_preview, content_refs_json, error_json, created_at, observation_json
      ) VALUES (
        @observation_id, @tool_call_id, @run_id, @step_id, @status, @summary,
        @text_preview, @content_refs_json, @error_json, @created_at, @observation_json
      )
      ON CONFLICT(observation_id) DO UPDATE SET
        status = excluded.status,
        summary = excluded.summary,
        text_preview = excluded.text_preview,
        content_refs_json = excluded.content_refs_json,
        error_json = excluded.error_json,
        observation_json = excluded.observation_json
    `).run({
      observation_id: observation.observationId,
      tool_call_id: observation.toolCallId,
      run_id: observation.runId,
      step_id: observation.stepId,
      status: observation.status,
      summary: observation.summary,
      text_preview: observation.textPreview ?? null,
      content_refs_json: observation.contentRefs ? stringifyJson(observation.contentRefs) : null,
      error_json: observation.error ? stringifyJson(observation.error) : null,
      created_at: observation.createdAt,
      observation_json: stringifyJson(observation),
    });
    return observation;
  }

  listToolObservationsByToolCall(toolCallId: string): ToolObservation[] {
    return (this.database.prepare('SELECT observation_json FROM tool_observations WHERE tool_call_id = ? ORDER BY created_at ASC').all(toolCallId) as ToolObservationRow[])
      .map((row) => JSON.parse(row.observation_json) as ToolObservation);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}
