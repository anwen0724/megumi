import type { MegumiDatabase } from '../connection';
import type {
  ApprovalRecord,
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolObservation,
  ToolResult,
  ToolUse,
} from '@megumi/shared/tool-contracts';

interface ToolUseRow { tool_use_json: string }
interface ToolCallRow { tool_call_json: string }
interface PermissionDecisionRow { decision_json: string }
interface ApprovalRequestRow { request_json: string }
interface ToolResultRow { result_json: string }
interface ToolObservationRow { observation_json: string }

export class ToolRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveToolUse(toolUse: ToolUse): ToolUse {
    this.database.prepare(`
      INSERT INTO tool_uses (
        tool_use_id, run_id, model_step_id, provider_tool_use_id, tool_name,
        input_json, input_preview_json, status, created_at, completed_at,
        error_json, metadata_json, tool_use_json
      ) VALUES (
        @tool_use_id, @run_id, @model_step_id, @provider_tool_use_id, @tool_name,
        @input_json, @input_preview_json, @status, @created_at, @completed_at,
        @error_json, @metadata_json, @tool_use_json
      )
      ON CONFLICT(tool_use_id) DO UPDATE SET
        run_id = excluded.run_id,
        model_step_id = excluded.model_step_id,
        provider_tool_use_id = excluded.provider_tool_use_id,
        tool_name = excluded.tool_name,
        input_json = excluded.input_json,
        input_preview_json = excluded.input_preview_json,
        status = excluded.status,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        tool_use_json = excluded.tool_use_json
    `).run({
      tool_use_id: toolUse.toolUseId,
      run_id: toolUse.runId,
      model_step_id: toolUse.modelStepId,
      provider_tool_use_id: toolUse.providerToolUseId,
      tool_name: toolUse.toolName,
      input_json: stringifyJson(toolUse.input),
      input_preview_json: stringifyJson(toolUse.inputPreview),
      status: toolUse.status,
      created_at: toolUse.createdAt,
      completed_at: toolUse.completedAt ?? null,
      error_json: toolUse.error ? stringifyJson(toolUse.error) : null,
      metadata_json: toolUse.metadata ? stringifyJson(toolUse.metadata) : null,
      tool_use_json: stringifyJson(toolUse),
    });
    return toolUse;
  }

  getToolUse(toolUseId: string): ToolUse | undefined {
    const row = this.database.prepare('SELECT tool_use_json FROM tool_uses WHERE tool_use_id = ?').get(toolUseId) as ToolUseRow | undefined;
    return row ? JSON.parse(row.tool_use_json) as ToolUse : undefined;
  }

  listToolUsesByRun(runId: string): ToolUse[] {
    return (this.database.prepare('SELECT tool_use_json FROM tool_uses WHERE run_id = ? ORDER BY created_at ASC').all(runId) as ToolUseRow[])
      .map((row) => JSON.parse(row.tool_use_json) as ToolUse);
  }

  saveToolCall(toolCall: ToolCall): ToolCall {
    this.database.prepare(`
      INSERT INTO tool_calls (
        tool_call_id, tool_use_id, run_id, step_id, action_id, tool_name, input_preview_json,
        capabilities_json, risk_level, side_effect, result_preview, status, requested_at,
        started_at, completed_at, error_json, metadata_json, tool_call_json
      ) VALUES (
        @tool_call_id, @tool_use_id, @run_id, @step_id, @action_id, @tool_name, @input_preview_json,
        @capabilities_json, @risk_level, @side_effect, @result_preview, @status, @requested_at,
        @started_at, @completed_at, @error_json, @metadata_json, @tool_call_json
      )
      ON CONFLICT(tool_call_id) DO UPDATE SET
        tool_use_id = excluded.tool_use_id,
        run_id = excluded.run_id,
        step_id = excluded.step_id,
        action_id = excluded.action_id,
        tool_name = excluded.tool_name,
        input_preview_json = excluded.input_preview_json,
        capabilities_json = excluded.capabilities_json,
        risk_level = excluded.risk_level,
        side_effect = excluded.side_effect,
        result_preview = excluded.result_preview,
        status = excluded.status,
        requested_at = excluded.requested_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        tool_call_json = excluded.tool_call_json
    `).run({
      tool_call_id: toolCall.toolCallId,
      tool_use_id: toolCall.toolUseId,
      run_id: toolCall.runId,
      step_id: toolCall.stepId,
      action_id: toolCall.actionId ?? null,
      tool_name: toolCall.toolName,
      input_preview_json: stringifyJson(toolCall.inputPreview),
      capabilities_json: stringifyJson(toolCall.capabilities),
      risk_level: toolCall.riskLevel,
      side_effect: toolCall.sideEffect,
      result_preview: toolCall.resultPreview ?? null,
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

  savePermissionDecision(decision: PermissionDecision): PermissionDecision {
    this.database.prepare(`
      INSERT INTO permission_decisions (
        permission_decision_id, tool_use_id, tool_call_id, run_id, decision,
        source, mode, reason, classifier_label, capability, side_effect,
        matched_rule_json, target, effective_risk_level, required_approval_json,
        required_sandbox_json, evaluated_at, metadata_json, decision_json
      ) VALUES (
        @permission_decision_id, @tool_use_id, @tool_call_id, @run_id, @decision,
        @source, @mode, @reason, @classifier_label, @capability, @side_effect,
        @matched_rule_json, @target, @effective_risk_level, @required_approval_json,
        @required_sandbox_json, @evaluated_at, @metadata_json, @decision_json
      )
      ON CONFLICT(permission_decision_id) DO UPDATE SET
        tool_use_id = excluded.tool_use_id,
        tool_call_id = excluded.tool_call_id,
        run_id = excluded.run_id,
        decision = excluded.decision,
        source = excluded.source,
        mode = excluded.mode,
        reason = excluded.reason,
        classifier_label = excluded.classifier_label,
        capability = excluded.capability,
        side_effect = excluded.side_effect,
        matched_rule_json = excluded.matched_rule_json,
        target = excluded.target,
        effective_risk_level = excluded.effective_risk_level,
        required_approval_json = excluded.required_approval_json,
        required_sandbox_json = excluded.required_sandbox_json,
        evaluated_at = excluded.evaluated_at,
        metadata_json = excluded.metadata_json,
        decision_json = excluded.decision_json
    `).run({
      permission_decision_id: decision.permissionDecisionId,
      tool_use_id: decision.toolUseId,
      tool_call_id: decision.toolCallId ?? null,
      run_id: decision.runId,
      decision: decision.decision,
      source: decision.source,
      mode: decision.mode,
      reason: decision.reason,
      classifier_label: decision.classifierLabel ?? null,
      capability: decision.capability,
      side_effect: decision.sideEffect,
      matched_rule_json: decision.matchedRule ? stringifyJson(decision.matchedRule) : null,
      target: decision.target ?? null,
      effective_risk_level: decision.effectiveRiskLevel,
      required_approval_json: decision.requiredApproval ? stringifyJson(decision.requiredApproval) : null,
      required_sandbox_json: decision.requiredSandbox ? stringifyJson(decision.requiredSandbox) : null,
      evaluated_at: decision.evaluatedAt,
      metadata_json: decision.metadata ? stringifyJson(decision.metadata) : null,
      decision_json: stringifyJson(decision),
    });
    return decision;
  }

  listPermissionDecisionsByToolUse(toolUseId: string): PermissionDecision[] {
    return (this.database.prepare('SELECT decision_json FROM permission_decisions WHERE tool_use_id = ? ORDER BY evaluated_at ASC').all(toolUseId) as PermissionDecisionRow[])
      .map((row) => JSON.parse(row.decision_json) as PermissionDecision);
  }

  saveApprovalRequest(request: ApprovalRequest): ApprovalRequest {
    this.database.prepare(`
      INSERT INTO approval_requests (
        approval_request_id, tool_use_id, tool_call_id, permission_decision_id,
        run_id, step_id, tool_name, status, requested_scope, risk_level,
        created_at, expires_at, resolved_at, request_json
      ) VALUES (
        @approval_request_id, @tool_use_id, @tool_call_id, @permission_decision_id,
        @run_id, @step_id, @tool_name, @status, @requested_scope, @risk_level,
        @created_at, @expires_at, @resolved_at, @request_json
      )
      ON CONFLICT(approval_request_id) DO UPDATE SET
        tool_use_id = excluded.tool_use_id,
        tool_call_id = excluded.tool_call_id,
        permission_decision_id = excluded.permission_decision_id,
        run_id = excluded.run_id,
        step_id = excluded.step_id,
        tool_name = excluded.tool_name,
        status = excluded.status,
        requested_scope = excluded.requested_scope,
        risk_level = excluded.risk_level,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at,
        resolved_at = excluded.resolved_at,
        request_json = excluded.request_json
    `).run({
      approval_request_id: request.approvalRequestId,
      tool_use_id: request.toolUseId,
      tool_call_id: request.toolCallId,
      permission_decision_id: request.permissionDecisionId ?? null,
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
    const request = this.getApprovalRequest(record.approvalRequestId);
    if (!request) {
      throw new Error(`Cannot save approval record without approval request: ${record.approvalRequestId}`);
    }
    if (record.toolCallId !== request.toolCallId) {
      throw new Error(`Approval record toolCallId ${record.toolCallId} does not match approval request toolCallId ${request.toolCallId}`);
    }
    if (record.runId !== request.runId) {
      throw new Error(`Approval record runId ${record.runId} does not match approval request runId ${request.runId}`);
    }
    if (record.stepId !== request.stepId) {
      throw new Error(`Approval record stepId ${record.stepId} does not match approval request stepId ${request.stepId}`);
    }

    this.database.prepare(`
      INSERT INTO approval_records (
        approval_record_id, approval_request_id, tool_use_id, tool_call_id, run_id, step_id,
        decision, scope, decided_by, decided_at, record_json
      ) VALUES (
        @approval_record_id, @approval_request_id, @tool_use_id, @tool_call_id, @run_id, @step_id,
        @decision, @scope, @decided_by, @decided_at, @record_json
      )
    `).run({
      approval_record_id: record.approvalRecordId,
      approval_request_id: record.approvalRequestId,
      tool_use_id: request.toolUseId,
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

  saveToolResult(result: ToolResult): ToolResult {
    this.database.prepare(`
      INSERT INTO tool_results (
        tool_result_id, tool_use_id, tool_call_id, run_id, kind, text_content,
        structured_content_json, content_refs_json, redaction_state, error_json,
        denial_reason, created_at, metadata_json, result_json
      ) VALUES (
        @tool_result_id, @tool_use_id, @tool_call_id, @run_id, @kind, @text_content,
        @structured_content_json, @content_refs_json, @redaction_state, @error_json,
        @denial_reason, @created_at, @metadata_json, @result_json
      )
      ON CONFLICT(tool_result_id) DO UPDATE SET
        tool_use_id = excluded.tool_use_id,
        tool_call_id = excluded.tool_call_id,
        run_id = excluded.run_id,
        kind = excluded.kind,
        text_content = excluded.text_content,
        structured_content_json = excluded.structured_content_json,
        content_refs_json = excluded.content_refs_json,
        redaction_state = excluded.redaction_state,
        error_json = excluded.error_json,
        denial_reason = excluded.denial_reason,
        created_at = excluded.created_at,
        metadata_json = excluded.metadata_json,
        result_json = excluded.result_json
    `).run({
      tool_result_id: result.toolResultId,
      tool_use_id: result.toolUseId,
      tool_call_id: result.toolCallId ?? null,
      run_id: result.runId,
      kind: result.kind,
      text_content: result.textContent ?? null,
      structured_content_json: result.structuredContent !== undefined ? stringifyJson(result.structuredContent) : null,
      content_refs_json: result.contentRefs ? stringifyJson(result.contentRefs) : null,
      redaction_state: result.redactionState,
      error_json: result.error ? stringifyJson(result.error) : null,
      denial_reason: result.denialReason ?? null,
      created_at: result.createdAt,
      metadata_json: result.metadata ? stringifyJson(result.metadata) : null,
      result_json: stringifyJson(result),
    });
    return result;
  }

  listToolResultsByToolUse(toolUseId: string): ToolResult[] {
    return (this.database.prepare('SELECT result_json FROM tool_results WHERE tool_use_id = ? ORDER BY created_at ASC').all(toolUseId) as ToolResultRow[])
      .map((row) => JSON.parse(row.result_json) as ToolResult);
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
        tool_call_id = excluded.tool_call_id,
        run_id = excluded.run_id,
        step_id = excluded.step_id,
        status = excluded.status,
        summary = excluded.summary,
        text_preview = excluded.text_preview,
        content_refs_json = excluded.content_refs_json,
        error_json = excluded.error_json,
        created_at = excluded.created_at,
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
