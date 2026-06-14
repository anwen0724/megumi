import type { MegumiDatabase } from '../connection';
import type {
  ApprovalRecord,
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolObservation,
  ToolResult,
} from '@megumi/shared/tool';

interface ToolCallRow { tool_call_json: string }
interface ToolExecutionRow { tool_execution_json: string }
interface PermissionDecisionRow { decision_json: string }
interface ApprovalRequestRow { request_json: string }
interface ToolResultRow { result_json: string }
interface ToolObservationRow { observation_json: string }

export class ToolRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveToolCall(toolCall: ToolCall): ToolCall {
    this.database.prepare(`
      INSERT INTO tool_calls (
        tool_call_id, run_id, model_step_id, provider_tool_call_id, tool_name,
        input_json, input_preview_json, status, created_at, completed_at,
        error_json, metadata_json, tool_call_json
      ) VALUES (
        @tool_call_id, @run_id, @model_step_id, @provider_tool_call_id, @tool_name,
        @input_json, @input_preview_json, @status, @created_at, @completed_at,
        @error_json, @metadata_json, @tool_call_json
      )
      ON CONFLICT(tool_call_id) DO UPDATE SET
        run_id = excluded.run_id,
        model_step_id = excluded.model_step_id,
        provider_tool_call_id = excluded.provider_tool_call_id,
        tool_name = excluded.tool_name,
        input_json = excluded.input_json,
        input_preview_json = excluded.input_preview_json,
        status = excluded.status,
        created_at = excluded.created_at,
        completed_at = excluded.completed_at,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json,
        tool_call_json = excluded.tool_call_json
    `).run({
      tool_call_id: toolCall.toolCallId,
      run_id: toolCall.runId,
      model_step_id: toolCall.modelStepId,
      provider_tool_call_id: toolCall.providerToolCallId,
      tool_name: toolCall.toolName,
      input_json: stringifyJson(toolCall.input),
      input_preview_json: stringifyJson(toolCall.inputPreview),
      status: toolCall.status,
      created_at: toolCall.createdAt,
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
    return (this.database.prepare('SELECT tool_call_json FROM tool_calls WHERE run_id = ? ORDER BY created_at ASC').all(runId) as ToolCallRow[])
      .map((row) => JSON.parse(row.tool_call_json) as ToolCall);
  }

  saveToolExecution(toolExecution: ToolExecution): ToolExecution {
    this.database.prepare(`
      INSERT INTO tool_executions (
        tool_execution_id, tool_call_id, run_id, step_id, action_id, tool_name,
        input_json, input_preview_json, capabilities_json, risk_level, side_effect,
        result_preview, status, requested_at, started_at, completed_at,
        error_json, metadata_json, tool_execution_json
      ) VALUES (
        @tool_execution_id, @tool_call_id, @run_id, @step_id, @action_id, @tool_name,
        @input_json, @input_preview_json, @capabilities_json, @risk_level, @side_effect,
        @result_preview, @status, @requested_at, @started_at, @completed_at,
        @error_json, @metadata_json, @tool_execution_json
      )
      ON CONFLICT(tool_execution_id) DO UPDATE SET
        tool_call_id = excluded.tool_call_id,
        run_id = excluded.run_id,
        step_id = excluded.step_id,
        action_id = excluded.action_id,
        tool_name = excluded.tool_name,
        input_json = excluded.input_json,
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
        tool_execution_json = excluded.tool_execution_json
    `).run({
      tool_execution_id: toolExecution.toolExecutionId,
      tool_call_id: toolExecution.toolCallId,
      run_id: toolExecution.runId,
      step_id: toolExecution.stepId,
      action_id: toolExecution.actionId ?? null,
      tool_name: toolExecution.toolName,
      input_json: stringifyJson(toolExecution.input),
      input_preview_json: stringifyJson(toolExecution.inputPreview),
      capabilities_json: stringifyJson(toolExecution.capabilities),
      risk_level: toolExecution.riskLevel,
      side_effect: toolExecution.sideEffect,
      result_preview: toolExecution.resultPreview ?? null,
      status: toolExecution.status,
      requested_at: toolExecution.requestedAt,
      started_at: toolExecution.startedAt ?? null,
      completed_at: toolExecution.completedAt ?? null,
      error_json: toolExecution.error ? stringifyJson(toolExecution.error) : null,
      metadata_json: toolExecution.metadata ? stringifyJson(toolExecution.metadata) : null,
      tool_execution_json: stringifyJson(toolExecution),
    });
    return toolExecution;
  }

  getToolExecution(toolExecutionId: string): ToolExecution | undefined {
    const row = this.database.prepare('SELECT tool_execution_json FROM tool_executions WHERE tool_execution_id = ?').get(toolExecutionId) as ToolExecutionRow | undefined;
    return row ? JSON.parse(row.tool_execution_json) as ToolExecution : undefined;
  }

  listToolExecutionsByRun(runId: string): ToolExecution[] {
    return (this.database.prepare('SELECT tool_execution_json FROM tool_executions WHERE run_id = ? ORDER BY requested_at ASC').all(runId) as ToolExecutionRow[])
      .map((row) => JSON.parse(row.tool_execution_json) as ToolExecution);
  }

  savePermissionDecision(decision: PermissionDecision): PermissionDecision {
    this.database.prepare(`
      INSERT INTO permission_decisions (
        permission_decision_id, tool_call_id, tool_execution_id, run_id, decision,
        source, mode, reason, classifier_label, capability, side_effect,
        matched_rule_json, target, effective_risk_level, required_approval_json,
        required_sandbox_json, evaluated_at, metadata_json, decision_json
      ) VALUES (
        @permission_decision_id, @tool_call_id, @tool_execution_id, @run_id, @decision,
        @source, @mode, @reason, @classifier_label, @capability, @side_effect,
        @matched_rule_json, @target, @effective_risk_level, @required_approval_json,
        @required_sandbox_json, @evaluated_at, @metadata_json, @decision_json
      )
      ON CONFLICT(permission_decision_id) DO UPDATE SET
        tool_call_id = excluded.tool_call_id,
        tool_execution_id = excluded.tool_execution_id,
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
      tool_call_id: decision.toolCallId,
      tool_execution_id: decision.toolExecutionId ?? null,
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

  listPermissionDecisionsByToolCall(toolCallId: string): PermissionDecision[] {
    return (this.database.prepare('SELECT decision_json FROM permission_decisions WHERE tool_call_id = ? ORDER BY evaluated_at ASC').all(toolCallId) as PermissionDecisionRow[])
      .map((row) => JSON.parse(row.decision_json) as PermissionDecision);
  }

  saveApprovalRequest(request: ApprovalRequest): ApprovalRequest {
    const toolExecution = this.getToolExecution(request.toolExecutionId);
    if (!toolExecution) {
      throw new Error(`Cannot save approval request without tool execution: ${request.toolExecutionId}`);
    }
    if (request.toolCallId !== toolExecution.toolCallId) {
      throw new Error(`Approval request toolCallId ${request.toolCallId} does not match tool execution toolCallId ${toolExecution.toolCallId}`);
    }
    if (request.runId !== toolExecution.runId) {
      throw new Error(`Approval request runId ${request.runId} does not match tool execution runId ${toolExecution.runId}`);
    }
    if (request.stepId !== toolExecution.stepId) {
      throw new Error(`Approval request stepId ${request.stepId} does not match tool execution stepId ${toolExecution.stepId}`);
    }
    if (request.permissionDecisionId) {
      const permissionDecision = this.getPermissionDecision(request.permissionDecisionId);
      if (!permissionDecision) {
        throw new Error(`Cannot save approval request without permission decision: ${request.permissionDecisionId}`);
      }
      if (permissionDecision.toolCallId !== request.toolCallId) {
        throw new Error(`Approval request permissionDecisionId ${request.permissionDecisionId} belongs to toolCallId ${permissionDecision.toolCallId}, not ${request.toolCallId}`);
      }
      if (permissionDecision.toolExecutionId && permissionDecision.toolExecutionId !== request.toolExecutionId) {
        throw new Error(`Approval request permissionDecisionId ${request.permissionDecisionId} belongs to toolExecutionId ${permissionDecision.toolExecutionId}, not ${request.toolExecutionId}`);
      }
      if (permissionDecision.runId !== request.runId) {
        throw new Error(`Approval request permissionDecisionId ${request.permissionDecisionId} belongs to runId ${permissionDecision.runId}, not ${request.runId}`);
      }
    }

    this.database.prepare(`
      INSERT INTO approval_requests (
        approval_request_id, tool_call_id, tool_execution_id, permission_decision_id,
        run_id, step_id, tool_name, status, requested_scope, risk_level,
        created_at, expires_at, resolved_at, request_json
      ) VALUES (
        @approval_request_id, @tool_call_id, @tool_execution_id, @permission_decision_id,
        @run_id, @step_id, @tool_name, @status, @requested_scope, @risk_level,
        @created_at, @expires_at, @resolved_at, @request_json
      )
      ON CONFLICT(approval_request_id) DO UPDATE SET
        tool_call_id = excluded.tool_call_id,
        tool_execution_id = excluded.tool_execution_id,
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
      tool_call_id: request.toolCallId,
      tool_execution_id: request.toolExecutionId,
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

  private getPermissionDecision(permissionDecisionId: string): PermissionDecision | undefined {
    const row = this.database.prepare('SELECT decision_json FROM permission_decisions WHERE permission_decision_id = ?').get(permissionDecisionId) as PermissionDecisionRow | undefined;
    return row ? JSON.parse(row.decision_json) as PermissionDecision : undefined;
  }

  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined {
    const row = this.database.prepare('SELECT request_json FROM approval_requests WHERE approval_request_id = ?').get(approvalRequestId) as ApprovalRequestRow | undefined;
    return row ? JSON.parse(row.request_json) as ApprovalRequest : undefined;
  }

  listPendingApprovalRequestsByRun(runId: string): ApprovalRequest[] {
    return (this.database.prepare(`
      SELECT request_json
      FROM approval_requests
      WHERE run_id = ?
        AND status = 'pending'
      ORDER BY created_at ASC, approval_request_id ASC
    `).all(runId) as ApprovalRequestRow[])
      .map((row) => JSON.parse(row.request_json) as ApprovalRequest);
  }

  listPendingToolExecutionsByRun(runId: string): ToolExecution[] {
    return (this.database.prepare(`
      SELECT tool_execution_json
      FROM tool_executions
      WHERE run_id = ?
        AND status IN ('pending_approval', 'running')
      ORDER BY requested_at ASC, tool_execution_id ASC
    `).all(runId) as ToolExecutionRow[])
      .map((row) => JSON.parse(row.tool_execution_json) as ToolExecution);
  }

  cancelPendingApprovalRequestsByRun(input: { runId: string; resolvedAt: string }): ApprovalRequest[] {
    const pending = this.listPendingApprovalRequestsByRun(input.runId);
    const cancelled = pending.map((request) => ({
      ...request,
      status: 'cancelled' as const,
      resolvedAt: input.resolvedAt,
    }));
    for (const request of cancelled) {
      this.saveApprovalRequest(request);
    }
    return cancelled;
  }

  cancelPendingToolExecutionsByRun(input: { runId: string; completedAt: string }): ToolExecution[] {
    const pending = this.listPendingToolExecutionsByRun(input.runId);
    const cancelled = pending.map((execution) => ({
      ...execution,
      status: 'cancelled' as const,
      completedAt: input.completedAt,
    }));
    for (const execution of cancelled) {
      this.saveToolExecution(execution);
    }
    return cancelled;
  }

  saveApprovalRecord(record: ApprovalRecord): ApprovalRecord {
    const request = this.getApprovalRequest(record.approvalRequestId);
    if (!request) {
      throw new Error(`Cannot save approval record without approval request: ${record.approvalRequestId}`);
    }
    if (record.toolExecutionId !== request.toolExecutionId) {
      throw new Error(`Approval record toolExecutionId ${record.toolExecutionId} does not match approval request toolExecutionId ${request.toolExecutionId}`);
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
        approval_record_id, approval_request_id, tool_call_id, tool_execution_id, run_id, step_id,
        decision, scope, decided_by, decided_at, record_json
      ) VALUES (
        @approval_record_id, @approval_request_id, @tool_call_id, @tool_execution_id, @run_id, @step_id,
        @decision, @scope, @decided_by, @decided_at, @record_json
      )
    `).run({
      approval_record_id: record.approvalRecordId,
      approval_request_id: record.approvalRequestId,
      tool_call_id: record.toolCallId,
      tool_execution_id: record.toolExecutionId,
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
        tool_result_id, tool_call_id, tool_execution_id, run_id, kind, text_content,
        structured_content_json, content_refs_json, redaction_state, error_json,
        denial_reason, created_at, metadata_json, result_json
      ) VALUES (
        @tool_result_id, @tool_call_id, @tool_execution_id, @run_id, @kind, @text_content,
        @structured_content_json, @content_refs_json, @redaction_state, @error_json,
        @denial_reason, @created_at, @metadata_json, @result_json
      )
      ON CONFLICT(tool_result_id) DO UPDATE SET
        tool_call_id = excluded.tool_call_id,
        tool_execution_id = excluded.tool_execution_id,
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
      tool_call_id: result.toolCallId,
      tool_execution_id: result.toolExecutionId ?? null,
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

  listToolResultsByToolCall(toolCallId: string): ToolResult[] {
    return (this.database.prepare('SELECT result_json FROM tool_results WHERE tool_call_id = ? ORDER BY created_at ASC').all(toolCallId) as ToolResultRow[])
      .map((row) => JSON.parse(row.result_json) as ToolResult);
  }

  saveToolObservation(observation: ToolObservation): ToolObservation {
    this.database.prepare(`
      INSERT INTO tool_observations (
        observation_id, tool_execution_id, run_id, step_id, status, summary,
        text_preview, content_refs_json, error_json, created_at, observation_json
      ) VALUES (
        @observation_id, @tool_execution_id, @run_id, @step_id, @status, @summary,
        @text_preview, @content_refs_json, @error_json, @created_at, @observation_json
      )
      ON CONFLICT(observation_id) DO UPDATE SET
        tool_execution_id = excluded.tool_execution_id,
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
      tool_execution_id: observation.toolExecutionId,
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

  listToolObservationsByToolExecution(toolExecutionId: string): ToolObservation[] {
    return (this.database.prepare('SELECT observation_json FROM tool_observations WHERE tool_execution_id = ? ORDER BY created_at ASC').all(toolExecutionId) as ToolObservationRow[])
      .map((row) => JSON.parse(row.observation_json) as ToolObservation);
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

