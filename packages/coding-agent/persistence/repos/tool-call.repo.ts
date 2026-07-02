// Owns tool source, registry snapshot, tool-call lifecycle and approval persistence.
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
import type { JsonObject } from '@megumi/shared/primitives';

export interface PersistedToolSource {
  sourceId: string;
  sourceKind: string;
  namespace: string;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  availabilityStatus: 'available' | 'unavailable' | 'unknown';
  availabilityReason?: string;
  healthCheckedAt?: string;
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedToolRegistrySnapshot {
  snapshotId: string;
  runId: string;
  projectId: string;
  permissionMode: string;
  modelId: string;
  createdAt: string;
  registryVersion: number;
  sourceVersionHash: string;
  sourceEntries: Array<{
    sourceId: string;
    sourceKind: string;
    namespace: string;
    displayName: string;
    configured: boolean;
    enabled: boolean;
    availabilityStatus: 'available' | 'unavailable' | 'unknown';
    availabilityReason?: string;
    healthCheckedAt?: string;
  }>;
  entries: Array<{
    snapshotEntryId: string;
    snapshotId: string;
    registrationId: string;
    canonicalToolId: string;
    modelVisibleName: string;
    sourceId: string;
    namespace: string;
    sourceToolName: string;
    definition: unknown;
    effectiveStatus: 'available' | 'disabled' | 'unavailable' | 'conflicted';
    disabledReason?: string;
    unavailableReason?: string;
    conflictReason?: string;
    exposedToModel: boolean;
    executionMode: 'parallel' | 'serial';
    createdAt: string;
  }>;
}

interface ToolSourceRow {
  metadata_json: string | null;
}

interface ToolRegistrySnapshotRow {
  snapshot_json: string;
}

interface ToolCallRow {
  tool_call_id: string;
  run_id: string;
  model_call_id: string;
  call_order: number;
  provider_tool_call_id: string | null;
  tool_name: string;
  model_visible_name: string;
  input_json: string;
  input_preview: string | null;
  status: string;
  permission_decision_json: string | null;
  result_json: string | null;
  result_preview: string | null;
  observation_json: string | null;
  submitted_to_model_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_json: string | null;
  metadata_json: string | null;
}

interface ApprovalRequestRow {
  request_json: string;
}

interface ToolCallMetadata {
  toolCall?: ToolCall;
  toolExecution?: ToolExecution;
  permissionDecisions?: PermissionDecision[];
  approvalRecord?: ApprovalRecord;
  results?: ToolResult[];
  observations?: ToolObservation[];
  registrySnapshotId?: string;
  snapshotEntryId?: string;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: string;
  sourceToolName?: string;
}

const ACTIVE_TOOL_EXECUTION_STATUSES = ['created', 'awaitingApproval', 'queued', 'running'] as const;

export class ToolCallRepository {
  constructor(private readonly database: MegumiDatabase) {}

  saveToolSource(source: PersistedToolSource): PersistedToolSource {
    this.database.prepare(`
      INSERT INTO tool_sources (
        tool_source_id, workspace_id, source_type, name, status, enabled,
        config_json, created_at, updated_at, metadata_json
      ) VALUES (
        @tool_source_id, NULL, @source_type, @name, @status, @enabled,
        @config_json, @created_at, @updated_at, @metadata_json
      )
      ON CONFLICT(tool_source_id) DO UPDATE SET
        source_type = excluded.source_type,
        name = excluded.name,
        status = excluded.status,
        enabled = excluded.enabled,
        config_json = excluded.config_json,
        updated_at = excluded.updated_at,
        metadata_json = excluded.metadata_json
    `).run({
      tool_source_id: source.sourceId,
      source_type: source.sourceKind,
      name: source.displayName,
      status: source.availabilityStatus,
      enabled: source.enabled ? 1 : 0,
      config_json: stringifyJson(source.config),
      created_at: source.createdAt,
      updated_at: source.updatedAt,
      metadata_json: stringifyJson({ source }),
    });
    return source;
  }

  getToolSource(sourceId: string): PersistedToolSource | undefined {
    const row = this.database
      .prepare('SELECT metadata_json FROM tool_sources WHERE tool_source_id = ?')
      .get(sourceId) as ToolSourceRow | undefined;
    return row ? parseJson<{ source: PersistedToolSource }>(row.metadata_json)?.source : undefined;
  }

  listToolSources(): PersistedToolSource[] {
    return (this.database.prepare('SELECT metadata_json FROM tool_sources ORDER BY tool_source_id ASC').all() as ToolSourceRow[])
      .map((row) => parseJson<{ source: PersistedToolSource }>(row.metadata_json)?.source)
      .filter((source): source is PersistedToolSource => Boolean(source));
  }

  seedDefaultToolSources(now: string): PersistedToolSource[] {
    const defaultSources: PersistedToolSource[] = [
      {
        sourceId: 'built_in',
        sourceKind: 'built_in',
        namespace: 'megumi',
        displayName: 'Built-in tools',
        configured: true,
        enabled: true,
        availabilityStatus: 'available',
        config: {},
        createdAt: now,
        updatedAt: now,
      },
      {
        sourceId: 'external_test',
        sourceKind: 'external_test',
        namespace: 'demo',
        displayName: 'External test tools',
        configured: true,
        enabled: false,
        availabilityStatus: 'available',
        config: {},
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const source of defaultSources) {
      if (!this.getToolSource(source.sourceId)) {
        this.saveToolSource(source);
      }
    }
    return this.listToolSources();
  }

  saveToolRegistrySnapshot(snapshot: PersistedToolRegistrySnapshot): PersistedToolRegistrySnapshot {
    throw new Error('Tool registry snapshot persistence is owned by AgentLoopRepository.');
  }

  getToolRegistrySnapshot(snapshotId: string): PersistedToolRegistrySnapshot | undefined {
    const row = this.database
      .prepare('SELECT snapshot_json FROM tool_registry_snapshots WHERE snapshot_id = ?')
      .get(snapshotId) as ToolRegistrySnapshotRow | undefined;
    return row ? parseJson<PersistedToolRegistrySnapshot>(row.snapshot_json) : undefined;
  }

  getToolRegistrySnapshotByRun(runId: string): PersistedToolRegistrySnapshot | undefined {
    const row = this.database
      .prepare('SELECT snapshot_json FROM tool_registry_snapshots WHERE run_id = ?')
      .get(runId) as ToolRegistrySnapshotRow | undefined;
    return row ? parseJson<PersistedToolRegistrySnapshot>(row.snapshot_json) : undefined;
  }

  listToolRegistrySnapshotEntries(snapshotId: string): PersistedToolRegistrySnapshot['entries'] {
    return this.getToolRegistrySnapshot(snapshotId)?.entries ?? [];
  }

  startToolCall(toolCall: ToolCall): ToolCall {
    return this.saveToolCall(toolCall);
  }

  listToolCallsForRun(runId: string): ToolCall[] {
    return this.listToolCallsByRun(runId);
  }

  recordToolExecution(toolExecution: ToolExecution): ToolExecution {
    return this.saveToolExecution(toolExecution);
  }

  recordPermissionDecision(decision: PermissionDecision): PermissionDecision {
    return this.savePermissionDecision(decision);
  }

  createApprovalRequest(request: ApprovalRequest): ApprovalRequest {
    return this.saveApprovalRequest(request);
  }

  resolveApprovalRequest(record: ApprovalRecord): ApprovalRecord {
    return this.saveApprovalRecord(record);
  }

  completeToolCall(result: ToolResult): ToolResult {
    return this.saveToolResult(result);
  }

  failToolCall(toolExecution: ToolExecution): ToolExecution {
    return this.saveToolExecution(toolExecution);
  }

  markToolObservationSubmitted(observation: ToolObservation): ToolObservation {
    return this.saveToolObservation(observation);
  }

  saveToolCall(toolCall: ToolCall): ToolCall {
    this.upsertToolCall({
      toolCall,
      status: toolCall.status,
      completedAt: toolCall.completedAt,
      error: toolCall.error,
    });
    return toolCall;
  }

  getToolCall(toolCallId: string): ToolCall | undefined {
    return this.toolCallMetadata(toolCallId)?.toolCall ?? this.toolCallFromRow(toolCallId);
  }

  listToolCallsByRun(runId: string): ToolCall[] {
    return (this.database
      .prepare('SELECT * FROM tool_calls WHERE run_id = ? ORDER BY call_order ASC, tool_call_id ASC')
      .all(runId) as ToolCallRow[])
      .map((row) => this.getToolCall(row.tool_call_id))
      .filter((toolCall): toolCall is ToolCall => Boolean(toolCall));
  }

  saveToolExecution(toolExecution: ToolExecution): ToolExecution {
    const toolCall = this.getToolCall(toolExecution.toolCallId) ?? toolCallFromExecution(toolExecution);
    this.upsertToolCall({
      toolCall,
      toolExecution,
      status: toolCallStatusForExecution(toolExecution.status),
      startedAt: toolExecution.startedAt,
      completedAt: toolExecution.completedAt,
      error: toolExecution.error,
      resultPreview: formatResultPreview(toolExecution.resultPreview),
      observation: toolExecution.observation,
    });
    return toolExecution;
  }

  getToolExecution(toolExecutionId: string): ToolExecution | undefined {
    const row = this.findToolCallRow((metadata) => metadata.toolExecution?.toolExecutionId === toolExecutionId);
    return row ? this.toolCallMetadata(row.tool_call_id)?.toolExecution : undefined;
  }

  listToolExecutionsByRun(runId: string): ToolExecution[] {
    return this.toolCallRowsByRun(runId)
      .map((row) => this.toolCallMetadata(row.tool_call_id)?.toolExecution)
      .filter((execution): execution is ToolExecution => Boolean(execution));
  }

  listToolExecutionsByAssistantMessage(input: {
    runId: string;
    assistantMessageId: string;
  }): ToolExecution[] {
    return this.listToolExecutionsByRun(input.runId)
      .filter((execution) => execution.assistantMessageId === input.assistantMessageId)
      .sort(compareToolExecutionOrder);
  }

  getToolExecutionByToolCallId(input: {
    runId: string;
    assistantMessageId: string;
    toolCallId: string;
  }): ToolExecution | undefined {
    const execution = this.toolCallMetadata(input.toolCallId)?.toolExecution;
    return execution?.runId === input.runId && execution.assistantMessageId === input.assistantMessageId
      ? execution
      : undefined;
  }

  markToolResultsSubmittedToModelInput(input: {
    toolExecutionIds: readonly string[];
    emittedAt: string;
  }): void {
    for (const id of input.toolExecutionIds) {
      const execution = this.getToolExecution(id);
      if (!execution) {
        continue;
      }
      this.saveToolExecution({
        ...execution,
        continuationEmitted: true,
        metadata: {
          ...(execution.metadata ?? {}),
          continuationEmittedAt: input.emittedAt,
        },
      });
      this.database.prepare(`
        UPDATE tool_calls
        SET submitted_to_model_at = @submitted_at
        WHERE tool_call_id = @tool_call_id
      `).run({ submitted_at: input.emittedAt, tool_call_id: execution.toolCallId });
    }
  }

  savePermissionDecision(decision: PermissionDecision): PermissionDecision {
    const metadata = this.requireToolCallMetadata(decision.toolCallId);
    metadata.permissionDecisions = [
      ...(metadata.permissionDecisions ?? []).filter((item) => item.permissionDecisionId !== decision.permissionDecisionId),
      decision,
    ];
    this.updateToolCallMetadata(decision.toolCallId, metadata, {
      permissionDecisionJson: stringifyJson(decision),
    });
    return decision;
  }

  listPermissionDecisionsByToolCall(toolCallId: string): PermissionDecision[] {
    return this.toolCallMetadata(toolCallId)?.permissionDecisions ?? [];
  }

  saveApprovalRequest(request: ApprovalRequest): ApprovalRequest {
    const toolExecution = this.getToolExecution(request.toolExecutionId);
    if (!toolExecution) {
      throw new Error(`Cannot save approval request without tool execution: ${request.toolExecutionId}`);
    }
    assertApprovalMatchesExecution(request, toolExecution);
    if (request.permissionDecisionId) {
      const decision = this.getPermissionDecision(request.permissionDecisionId);
      if (!decision) {
        throw new Error(`Cannot save approval request without permission decision: ${request.permissionDecisionId}`);
      }
    }

    this.database.prepare(`
      INSERT INTO approval_requests (
        approval_request_id, run_id, tool_call_id, status, requested_scope,
        risk_level, request_json, decision, decided_by, decided_at,
        created_at, expires_at, metadata_json
      ) VALUES (
        @approval_request_id, @run_id, @tool_call_id, @status, @requested_scope,
        @risk_level, @request_json, NULL, NULL, NULL,
        @created_at, @expires_at, @metadata_json
      )
      ON CONFLICT(approval_request_id) DO UPDATE SET
        status = excluded.status,
        requested_scope = excluded.requested_scope,
        risk_level = excluded.risk_level,
        request_json = excluded.request_json,
        expires_at = excluded.expires_at,
        metadata_json = excluded.metadata_json
    `).run({
      approval_request_id: request.approvalRequestId,
      run_id: request.runId,
      tool_call_id: request.toolCallId,
      status: request.status,
      requested_scope: request.requestedScope,
      risk_level: request.riskLevel,
      request_json: stringifyJson(request),
      created_at: request.createdAt,
      expires_at: request.expiresAt ?? null,
      metadata_json: stringifyJson({
        toolExecutionId: request.toolExecutionId,
        permissionDecisionId: request.permissionDecisionId,
        stepId: request.stepId,
        toolName: request.toolName,
        identity: identityMetadata(request),
        resolvedAt: request.resolvedAt,
      }),
    });
    this.database.prepare('UPDATE tool_calls SET approval_request_id = ? WHERE tool_call_id = ?')
      .run(request.approvalRequestId, request.toolCallId);
    return request;
  }

  getApprovalRequest(approvalRequestId: string): ApprovalRequest | undefined {
    const row = this.database
      .prepare('SELECT request_json FROM approval_requests WHERE approval_request_id = ?')
      .get(approvalRequestId) as ApprovalRequestRow | undefined;
    return row ? parseJson<ApprovalRequest>(row.request_json) : undefined;
  }

  listPendingApprovalRequestsByRun(runId: string): ApprovalRequest[] {
    return (this.database.prepare(`
      SELECT request_json
      FROM approval_requests
      WHERE run_id = ?
        AND status = 'pending'
      ORDER BY created_at ASC, approval_request_id ASC
    `).all(runId) as ApprovalRequestRow[]).map((row) => parseJson<ApprovalRequest>(row.request_json));
  }

  listPendingToolExecutionsByRun(runId: string): ToolExecution[] {
    return this.listToolExecutionsByRun(runId)
      .filter((execution) =>
        (ACTIVE_TOOL_EXECUTION_STATUSES as readonly ToolExecution['status'][]).includes(execution.status),
      );
  }

  cancelPendingApprovalRequestsByRun(input: { runId: string; resolvedAt: string }): ApprovalRequest[] {
    const cancelled = this.listPendingApprovalRequestsByRun(input.runId).map((request) => ({
      ...request,
      status: 'cancelled' as const,
      resolvedAt: input.resolvedAt,
    }));
    for (const request of cancelled) {
      this.saveApprovalRequest(request);
      this.database.prepare(`
        UPDATE approval_requests
        SET decision = 'cancelled',
            decided_at = @decided_at
        WHERE approval_request_id = @approval_request_id
      `).run({ decided_at: input.resolvedAt, approval_request_id: request.approvalRequestId });
    }
    return cancelled;
  }

  cancelPendingToolExecutionsByRun(input: {
    runId: string;
    completedAt: string;
    statuses?: readonly ToolExecution['status'][];
  }): ToolExecution[] {
    const statuses = input.statuses ?? ACTIVE_TOOL_EXECUTION_STATUSES;
    const cancelled = this.listToolExecutionsByRun(input.runId)
      .filter((execution) => statuses.includes(execution.status))
      .map((execution) => ({
        ...execution,
        status: 'cancelled' as const,
        completedAt: input.completedAt,
      }));
    for (const execution of cancelled) {
      this.saveToolExecution(execution);
    }
    return cancelled;
  }

  failRunningToolExecutionsByRun(input: {
    runId: string;
    completedAt: string;
    createObservation(record: ToolExecution): ToolObservation;
  }): ToolExecution[] {
    const interruptedError: NonNullable<ToolExecution['error']> = {
      code: 'runtime_unknown',
      message: 'Tool execution was interrupted before completion.',
      severity: 'error',
      retryable: false,
      source: 'tool',
    };
    const failed: ToolExecution[] = this.listToolExecutionsByRun(input.runId)
      .filter((record) => record.status === 'running')
      .map((record) => ({
        ...record,
        status: 'failed' as const,
        completedAt: input.completedAt,
        observation: input.createObservation(record),
        error: interruptedError,
      }));
    for (const execution of failed) {
      this.saveToolExecution(execution);
    }
    return failed;
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

    const metadata = this.requireToolCallMetadata(record.toolCallId);
    metadata.approvalRecord = record;
    this.updateToolCallMetadata(record.toolCallId, metadata);
    this.database.prepare(`
      UPDATE approval_requests
      SET decision = @decision,
          decided_by = @decided_by,
          decided_at = @decided_at,
          status = 'resolved'
      WHERE approval_request_id = @approval_request_id
    `).run({
      decision: record.decision,
      decided_by: record.decidedBy,
      decided_at: record.decidedAt,
      approval_request_id: record.approvalRequestId,
    });
    return record;
  }

  saveToolResult(result: ToolResult): ToolResult {
    const metadata = this.requireToolCallMetadata(result.toolCallId);
    metadata.results = [
      ...(metadata.results ?? []).filter((item) => item.toolResultId !== result.toolResultId),
      result,
    ];
    this.updateToolCallMetadata(result.toolCallId, metadata, {
      resultJson: stringifyJson(result),
      resultPreview: result.textContent ?? result.denialReason ?? null,
    });
    return result;
  }

  listToolResultsByToolCall(toolCallId: string): ToolResult[] {
    return this.toolCallMetadata(toolCallId)?.results ?? [];
  }

  saveToolObservation(observation: ToolObservation): ToolObservation {
    const execution = this.getToolExecution(observation.toolExecutionId);
    if (!execution) {
      throw new Error(`Cannot save tool observation without tool execution: ${observation.toolExecutionId}`);
    }
    const metadata = this.requireToolCallMetadata(execution.toolCallId);
    metadata.observations = [
      ...(metadata.observations ?? []).filter((item) => item.observationId !== observation.observationId),
      observation,
    ];
    this.updateToolCallMetadata(execution.toolCallId, metadata, {
      observationJson: stringifyJson(observation),
    });
    return observation;
  }

  listToolObservationsByToolExecution(toolExecutionId: string): ToolObservation[] {
    const execution = this.getToolExecution(toolExecutionId);
    return execution ? this.toolCallMetadata(execution.toolCallId)?.observations ?? [] : [];
  }

  private getPermissionDecision(permissionDecisionId: string): PermissionDecision | undefined {
    for (const row of this.allToolCallRows()) {
      const match = this.toolCallMetadata(row.tool_call_id)?.permissionDecisions
        ?.find((decision) => decision.permissionDecisionId === permissionDecisionId);
      if (match) {
        return match;
      }
    }
    return undefined;
  }

  private upsertToolCall(input: {
    toolCall: ToolCall;
    toolExecution?: ToolExecution;
    status: ToolCall['status'];
    startedAt?: string;
    completedAt?: string;
    error?: unknown;
    resultPreview?: string | null;
    observation?: ToolObservation;
  }): void {
    const existingMetadata = this.toolCallMetadata(input.toolCall.toolCallId) ?? {};
    const metadata: ToolCallMetadata = {
      ...existingMetadata,
      toolCall: input.toolCall,
      ...(input.toolExecution ? { toolExecution: input.toolExecution } : {}),
      ...(input.observation ? { observations: mergeById(existingMetadata.observations ?? [], input.observation, 'observationId') } : {}),
      ...identityMetadata(input.toolCall),
    };
    const callOrder = input.toolExecution?.callOrder ?? this.callOrderFor(input.toolCall);

    this.database.prepare(`
      INSERT INTO tool_calls (
        tool_call_id, run_id, model_call_id, call_order, provider_tool_call_id,
        tool_source_id, tool_name, model_visible_name, input_json, input_preview,
        status, permission_decision_json, approval_request_id, result_json,
        result_preview, observation_json, submitted_to_model_at, started_at,
        completed_at, error_json, metadata_json
      ) VALUES (
        @tool_call_id, @run_id, @model_call_id, @call_order, @provider_tool_call_id,
        @tool_source_id, @tool_name, @model_visible_name, @input_json, @input_preview,
        @status, @permission_decision_json, @approval_request_id, @result_json,
        @result_preview, @observation_json, @submitted_to_model_at, @started_at,
        @completed_at, @error_json, @metadata_json
      )
      ON CONFLICT(tool_call_id) DO UPDATE SET
        status = excluded.status,
        permission_decision_json = COALESCE(excluded.permission_decision_json, tool_calls.permission_decision_json),
        result_json = COALESCE(excluded.result_json, tool_calls.result_json),
        result_preview = COALESCE(excluded.result_preview, tool_calls.result_preview),
        observation_json = COALESCE(excluded.observation_json, tool_calls.observation_json),
        submitted_to_model_at = COALESCE(excluded.submitted_to_model_at, tool_calls.submitted_to_model_at),
        started_at = COALESCE(excluded.started_at, tool_calls.started_at),
        completed_at = COALESCE(excluded.completed_at, tool_calls.completed_at),
        error_json = COALESCE(excluded.error_json, tool_calls.error_json),
        metadata_json = excluded.metadata_json
    `).run({
      tool_call_id: input.toolCall.toolCallId,
      run_id: input.toolCall.runId,
      model_call_id: input.toolCall.modelStepId,
      call_order: callOrder,
      provider_tool_call_id: input.toolCall.providerToolCallId ?? null,
      tool_source_id: input.toolCall.sourceId ?? null,
      tool_name: input.toolCall.toolName,
      model_visible_name: input.toolCall.modelVisibleName ?? input.toolCall.toolName,
      input_json: stringifyJson(input.toolCall.input),
      input_preview: input.toolCall.inputPreview ? stringifyJson(input.toolCall.inputPreview) : null,
      status: input.status,
      permission_decision_json: null,
      approval_request_id: null,
      result_json: null,
      result_preview: input.resultPreview ?? null,
      observation_json: input.observation ? stringifyJson(input.observation) : null,
      submitted_to_model_at: null,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? null,
      error_json: input.error ? stringifyJson(input.error) : null,
      metadata_json: stringifyJson(metadata),
    });
  }

  private callOrderFor(toolCall: ToolCall): number {
    const existing = this.database
      .prepare('SELECT call_order FROM tool_calls WHERE tool_call_id = ?')
      .get(toolCall.toolCallId) as { call_order: number } | undefined;
    if (existing) {
      return existing.call_order;
    }
    const next = this.database
      .prepare('SELECT COALESCE(MAX(call_order), 0) + 1 AS next_order FROM tool_calls WHERE run_id = ?')
      .get(toolCall.runId) as { next_order: number };
    return next.next_order;
  }

  private requireToolCallMetadata(toolCallId: string): ToolCallMetadata {
    const metadata = this.toolCallMetadata(toolCallId);
    if (!metadata) {
      throw new Error(`Tool call ${toolCallId} does not exist`);
    }
    return metadata;
  }

  private updateToolCallMetadata(
    toolCallId: string,
    metadata: ToolCallMetadata,
    extra: {
      permissionDecisionJson?: string;
      resultJson?: string;
      resultPreview?: string | null;
      observationJson?: string;
    } = {},
  ): void {
    this.database.prepare(`
      UPDATE tool_calls
      SET metadata_json = @metadata_json,
          permission_decision_json = COALESCE(@permission_decision_json, permission_decision_json),
          result_json = COALESCE(@result_json, result_json),
          result_preview = COALESCE(@result_preview, result_preview),
          observation_json = COALESCE(@observation_json, observation_json)
      WHERE tool_call_id = @tool_call_id
    `).run({
      tool_call_id: toolCallId,
      metadata_json: stringifyJson(metadata),
      permission_decision_json: extra.permissionDecisionJson ?? null,
      result_json: extra.resultJson ?? null,
      result_preview: extra.resultPreview ?? null,
      observation_json: extra.observationJson ?? null,
    });
  }

  private toolCallMetadata(toolCallId: string): ToolCallMetadata | undefined {
    const row = this.database
      .prepare('SELECT metadata_json FROM tool_calls WHERE tool_call_id = ?')
      .get(toolCallId) as { metadata_json: string | null } | undefined;
    return parseJson<ToolCallMetadata>(row?.metadata_json ?? null);
  }

  private toolCallFromRow(toolCallId: string): ToolCall | undefined {
    const row = this.database
      .prepare('SELECT * FROM tool_calls WHERE tool_call_id = ?')
      .get(toolCallId) as ToolCallRow | undefined;
    if (!row) {
      return undefined;
    }
    return {
      toolCallId: row.tool_call_id,
      runId: row.run_id,
      modelStepId: row.model_call_id,
      providerToolCallId: row.provider_tool_call_id ?? row.tool_call_id,
      toolName: row.tool_name,
      modelVisibleName: row.model_visible_name,
      input: parseJson(row.input_json),
      inputPreview: row.input_preview
        ? parseJson<ToolCall['inputPreview']>(row.input_preview)
        : { summary: row.tool_name, targets: [], redactionState: 'none' },
      status: row.status as ToolCall['status'],
      createdAt: row.started_at ?? '',
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      ...(row.error_json ? { error: parseJson(row.error_json) } : {}),
    };
  }

  private allToolCallRows(): ToolCallRow[] {
    return this.database.prepare('SELECT * FROM tool_calls ORDER BY run_id ASC, call_order ASC').all() as ToolCallRow[];
  }

  private toolCallRowsByRun(runId: string): ToolCallRow[] {
    return this.database
      .prepare('SELECT * FROM tool_calls WHERE run_id = ? ORDER BY call_order ASC, tool_call_id ASC')
      .all(runId) as ToolCallRow[];
  }

  private findToolCallRow(predicate: (metadata: ToolCallMetadata) => boolean): ToolCallRow | undefined {
    return this.allToolCallRows().find((row) => predicate(this.toolCallMetadata(row.tool_call_id) ?? {}));
  }
}

function toolCallFromExecution(execution: ToolExecution): ToolCall {
  return {
    toolCallId: execution.toolCallId,
    runId: execution.runId,
    modelStepId: execution.stepId,
    providerToolCallId: execution.toolCallId,
    toolName: execution.toolName,
    ...(execution.modelVisibleName ? { modelVisibleName: execution.modelVisibleName } : {}),
    input: execution.input,
    inputPreview: toToolInputPreview(execution.inputPreview, execution.toolName),
    status: toolCallStatusForExecution(execution.status),
    createdAt: execution.requestedAt,
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
    ...(execution.error ? { error: execution.error } : {}),
    ...identityMetadata(execution),
  };
}

function assertApprovalMatchesExecution(request: ApprovalRequest, execution: ToolExecution): void {
  if (request.toolCallId !== execution.toolCallId) {
    throw new Error(`Approval request toolCallId ${request.toolCallId} does not match tool execution toolCallId ${execution.toolCallId}`);
  }
  if (request.runId !== execution.runId) {
    throw new Error(`Approval request runId ${request.runId} does not match tool execution runId ${execution.runId}`);
  }
  if (request.stepId !== execution.stepId) {
    throw new Error(`Approval request stepId ${request.stepId} does not match tool execution stepId ${execution.stepId}`);
  }
}

function identityMetadata(value: {
  registrySnapshotId?: string;
  snapshotEntryId?: string;
  canonicalToolId?: string;
  sourceId?: string;
  namespace?: string;
  sourceToolName?: string;
}): Pick<ToolCallMetadata, 'registrySnapshotId' | 'snapshotEntryId' | 'canonicalToolId' | 'sourceId' | 'namespace' | 'sourceToolName'> {
  return {
    ...(value.registrySnapshotId ? { registrySnapshotId: value.registrySnapshotId } : {}),
    ...(value.snapshotEntryId ? { snapshotEntryId: value.snapshotEntryId } : {}),
    ...(value.canonicalToolId ? { canonicalToolId: value.canonicalToolId } : {}),
    ...(value.sourceId ? { sourceId: value.sourceId } : {}),
    ...(value.namespace ? { namespace: value.namespace } : {}),
    ...(value.sourceToolName ? { sourceToolName: value.sourceToolName } : {}),
  };
}

function workspaceIdForRun(database: MegumiDatabase, runId: string): string | null {
  const row = database
    .prepare('SELECT workspace_id FROM agent_loop_runs WHERE run_id = ?')
    .get(runId) as { workspace_id: string } | undefined;
  return row?.workspace_id ?? null;
}

function mergeById<T extends Record<K, string>, K extends keyof T>(items: T[], next: T, key: K): T[] {
  return [...items.filter((item) => item[key] !== next[key]), next];
}

function compareToolExecutionOrder(left: ToolExecution, right: ToolExecution): number {
  return (left.callOrder ?? 0) - (right.callOrder ?? 0)
    || left.requestedAt.localeCompare(right.requestedAt)
    || left.toolExecutionId.localeCompare(right.toolExecutionId);
}

function toolCallStatusForExecution(status: ToolExecution['status']): ToolCall['status'] {
  switch (status) {
    case 'created':
      return 'created';
    case 'awaitingApproval':
    case 'queued':
    case 'running':
      return 'queued_for_execution';
    case 'succeeded':
      return 'completed';
    case 'rejected':
      return 'denied';
    case 'failed':
    case 'cancelled':
      return 'failed';
  }
}

function toToolInputPreview(value: ToolExecution['inputPreview'], toolName: string): ToolCall['inputPreview'] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const maybePreview = value as Partial<ToolCall['inputPreview']>;
    if (
      typeof maybePreview.summary === 'string'
      && Array.isArray(maybePreview.targets)
      && typeof maybePreview.redactionState === 'string'
    ) {
      return maybePreview as ToolCall['inputPreview'];
    }
  }
  return {
    summary: toolName,
    targets: [],
    redactionState: 'none',
  };
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T;
function parseJson<T>(value: string | null): T | undefined;
function parseJson<T>(value: string | null): T | undefined {
  return value ? JSON.parse(value) as T : undefined;
}

function formatResultPreview(value: ToolExecution['resultPreview']): string | null {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'string' ? value : stringifyJson(value);
}
