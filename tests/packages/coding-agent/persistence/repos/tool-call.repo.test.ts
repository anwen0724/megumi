// Verifies tool persistence through the new aggregate tool_calls schema.
// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolCallRepository } from '@megumi/coding-agent/persistence/repos/tool-call.repo';
import { AgentLoopRepository } from '@megumi/coding-agent/persistence/repos/agent-loop.repo';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type {
  ApprovalRecord,
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolExecution,
  ToolObservation,
  ToolRegistrySnapshot,
  ToolResult,
  ToolSource,
} from '@megumi/shared/tool';

let db: Database.Database | null = null;

function createRepo(): ToolCallRepository {
  db = new Database(':memory:');
  applyCodingAgentDatabaseMigrations(db);
  seedLifecycle(db);
  return new ToolCallRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ToolCallRepository', () => {
  it('creates aggregate tool tables without legacy split lifecycle tables', () => {
    createRepo();

    expect(tableNames()).toEqual(expect.arrayContaining([
      'tool_sources',
      'tool_registry_snapshots',
      'tool_calls',
      'approval_requests',
    ]));
    expect(tableNames()).not.toEqual(expect.arrayContaining([
      'tool_executions',
      'tool_results',
      'tool_observations',
      'permission_decisions',
      'approval_records',
      'tool_registry_snapshot_entries',
      'tool_uses',
    ]));
  });

  it('seeds default tool sources without overwriting enablement', () => {
    const repo = createRepo();

    repo.seedDefaultToolSources('2026-06-14T00:00:00.000Z');

    expect(repo.getToolSource('built_in')).toMatchObject({
      enabled: true,
      namespace: 'megumi',
      availabilityStatus: 'available',
    });
    expect(repo.getToolSource('external_test')).toMatchObject({
      enabled: false,
      namespace: 'demo',
      availabilityStatus: 'available',
    });

    const externalTest = repo.getToolSource('external_test');
    if (!externalTest) {
      throw new Error('Expected external_test source.');
    }
    repo.saveToolSource({
      ...externalTest,
      enabled: true,
      updatedAt: '2026-06-14T00:00:01.000Z',
    });
    repo.seedDefaultToolSources('2026-06-14T00:00:02.000Z');

    expect(repo.getToolSource('external_test')?.enabled).toBe(true);
  });

  it('saves tool sources into the aggregate source table', () => {
    const repo = createRepo();
    const source = createToolSource({
      sourceId: 'test_external',
      sourceKind: 'external_test',
      namespace: 'demo',
      displayName: 'Test external tools',
      enabled: false,
    });

    repo.saveToolSource(source);

    expect(repo.getToolSource('test_external')).toEqual(source);
    expect(repo.listToolSources()).toContainEqual(source);

    const row = currentDb().prepare(`
      SELECT tool_source_id, source_type, name, enabled, status, config_json, metadata_json
      FROM tool_sources
      WHERE tool_source_id = 'test_external'
    `).get() as {
      tool_source_id: string;
      source_type: string;
      name: string;
      enabled: number;
      status: string;
      config_json: string;
      metadata_json: string;
    };
    expect(row).toMatchObject({
      tool_source_id: 'test_external',
      source_type: 'external_test',
      name: 'Test external tools',
      enabled: 0,
      status: 'available',
    });
    expect(JSON.parse(row.config_json)).toEqual({});
    expect(JSON.parse(row.metadata_json).source).toEqual(source);
  });

  it('saves run-level registry snapshots as JSON without entry rows', () => {
    const repo = createRepo();
    const snapshot = createToolRegistrySnapshot();

    repo.saveToolSource(createToolSource());
    expect(() => repo.saveToolRegistrySnapshot(snapshot)).toThrow('Tool registry snapshot persistence is owned by AgentLoopRepository.');
    new AgentLoopRepository(currentDb()).saveToolRegistrySnapshot(snapshot);

    expect(repo.getToolRegistrySnapshot('tool-registry-snapshot-1')).toEqual(snapshot);
    expect(repo.getToolRegistrySnapshotByRun('run-1')).toEqual(snapshot);
    expect(repo.listToolRegistrySnapshotEntries('tool-registry-snapshot-1')).toEqual(snapshot.entries);

    const snapshotRow = currentDb().prepare(`
      SELECT run_id, workspace_id, tool_count, snapshot_json, metadata_json
      FROM tool_registry_snapshots
      WHERE snapshot_id = 'tool-registry-snapshot-1'
    `).get() as {
      run_id: string;
      workspace_id: string;
      tool_count: number;
      snapshot_json: string;
      metadata_json: string;
    };
    expect(snapshotRow).toMatchObject({
      run_id: 'run-1',
      workspace_id: 'project-1',
      tool_count: 1,
    });
    expect(JSON.parse(snapshotRow.snapshot_json)).toEqual(snapshot);
    expect(JSON.parse(snapshotRow.metadata_json)).toMatchObject({
      projectId: 'project-1',
      permissionMode: 'default',
      sourceEntries: snapshot.sourceEntries,
    });
  });

  it('stores tool calls, execution facts, decisions, results and observations on one tool_calls row', () => {
    const repo = createRepo();
    const identity = toolIdentity();
    const toolCall = createToolCall(identity);
    const execution = createToolExecution(identity);
    const decision = createPermissionDecision(identity);
    const result = createToolResult();
    const observation = createToolObservation();

    repo.saveToolSource(createToolSource());
    repo.startToolCall(toolCall);
    repo.saveToolExecution(execution);
    repo.recordPermissionDecision(decision);
    repo.completeToolCall(result);
    repo.markToolObservationSubmitted(observation);

    expect(repo.getToolCall('tool-call-1')).toEqual(toolCall);
    expect(repo.listToolCallsForRun('run-1')).toEqual([toolCall]);
    expect(repo.getToolExecution('tool-execution-1')).toEqual(execution);
    expect(repo.listPermissionDecisionsByToolCall('tool-call-1')).toEqual([decision]);
    expect(repo.listToolResultsByToolCall('tool-call-1')).toEqual([result]);
    expect(repo.listToolObservationsByToolExecution('tool-execution-1')).toEqual([observation]);

    const row = currentDb().prepare(`
      SELECT
        tool_call_id,
        run_id,
        model_call_id,
        provider_tool_call_id,
        tool_source_id,
        tool_name,
        model_visible_name,
        status,
        permission_decision_json,
        result_json,
        result_preview,
        observation_json,
        metadata_json
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-1'
    `).get() as Record<string, string>;

    expect(row).toMatchObject({
      tool_call_id: 'tool-call-1',
      run_id: 'run-1',
      model_call_id: 'model-step-1',
      provider_tool_call_id: 'provider-tool-call-1',
      tool_source_id: 'built_in',
      tool_name: 'read_file',
      model_visible_name: 'read_file',
      status: 'queued_for_execution',
      result_preview: 'export {}',
    });
    expect(JSON.parse(row.permission_decision_json)).toEqual(decision);
    expect(JSON.parse(row.result_json)).toEqual(result);
    expect(JSON.parse(row.observation_json)).toEqual(observation);
    const { modelVisibleName: _modelVisibleName, ...storedIdentity } = identity;
    expect(JSON.parse(row.metadata_json)).toMatchObject({
      toolCall,
      toolExecution: execution,
      permissionDecisions: [decision],
      results: [result],
      observations: [observation],
      ...storedIdentity,
    });
  });

  it('stores approval requests in approval_requests and approval records in tool metadata', () => {
    const repo = createRepo();
    const approval = createApprovalRequest();
    const record = createApprovalRecord();

    repo.startToolCall(createToolCall());
    repo.saveToolExecution(createToolExecution());
    repo.recordPermissionDecision(createPermissionDecision());
    repo.createApprovalRequest(approval);
    repo.resolveApprovalRequest(record);

    expect(repo.getApprovalRequest('approval-1')).toEqual(approval);

    const approvalRow = currentDb().prepare(`
      SELECT tool_call_id, run_id, status, requested_scope, risk_level, request_json, decision, decided_by, decided_at, metadata_json
      FROM approval_requests
      WHERE approval_request_id = 'approval-1'
    `).get() as Record<string, string>;
    expect(approvalRow).toMatchObject({
      tool_call_id: 'tool-call-1',
      run_id: 'run-1',
      status: 'resolved',
      requested_scope: 'once',
      risk_level: 'low',
      decision: 'approved',
      decided_by: 'user',
      decided_at: '2026-05-20T00:00:05.000Z',
    });
    expect(JSON.parse(approvalRow.request_json)).toEqual(approval);
    expect(JSON.parse(approvalRow.metadata_json)).toMatchObject({
      toolExecutionId: 'tool-execution-1',
      permissionDecisionId: 'permission-decision-1',
    });

    const metadata = currentDb().prepare(`
      SELECT approval_request_id, metadata_json
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-1'
    `).get() as { approval_request_id: string; metadata_json: string };
    expect(metadata.approval_request_id).toBe('approval-1');
    expect(JSON.parse(metadata.metadata_json).approvalRecord).toEqual(record);
  });

  it('lists pending approvals and active executions by run, then cancels them', () => {
    const repo = createRepo();

    repo.startToolCall(createToolCall({
      toolCallId: 'tool-call-pending',
      providerToolCallId: 'provider-tool-call-pending',
    }));
    repo.saveToolExecution(createToolExecution({
      toolCallId: 'tool-call-pending',
      toolExecutionId: 'tool-execution-pending',
      status: 'awaitingApproval',
    }));
    repo.createApprovalRequest(createApprovalRequest({
      approvalRequestId: 'approval-pending',
      toolCallId: 'tool-call-pending',
      toolExecutionId: 'tool-execution-pending',
      permissionDecisionId: undefined,
    }));

    expect(repo.listPendingApprovalRequestsByRun('run-1')).toHaveLength(1);
    expect(repo.listPendingToolExecutionsByRun('run-1')).toHaveLength(1);

    repo.cancelPendingApprovalRequestsByRun({
      runId: 'run-1',
      resolvedAt: '2026-06-14T00:00:05.000Z',
    });
    repo.cancelPendingToolExecutionsByRun({
      runId: 'run-1',
      completedAt: '2026-06-14T00:00:05.000Z',
    });

    expect(repo.getApprovalRequest('approval-pending')).toMatchObject({
      status: 'cancelled',
      resolvedAt: '2026-06-14T00:00:05.000Z',
    });
    expect(repo.getToolExecution('tool-execution-pending')).toMatchObject({
      status: 'cancelled',
      completedAt: '2026-06-14T00:00:05.000Z',
    });
  });

  it('marks tool results submitted to model input without changing terminal execution outcome', () => {
    const repo = createRepo();
    repo.startToolCall(createToolCall());
    repo.failToolCall(createToolExecution({ status: 'failed', continuationEmitted: false }));

    repo.markToolResultsSubmittedToModelInput({
      toolExecutionIds: ['tool-execution-1'],
      emittedAt: '2026-06-15T00:00:01.000Z',
    });

    const record = repo.getToolExecution('tool-execution-1');
    expect(record?.status).toBe('failed');
    expect(record?.continuationEmitted).toBe(true);
    expect(record?.metadata?.continuationEmittedAt).toBe('2026-06-15T00:00:01.000Z');

    const row = currentDb().prepare(`
      SELECT submitted_to_model_at
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-1'
    `).get() as { submitted_to_model_at: string };
    expect(row.submitted_to_model_at).toBe('2026-06-15T00:00:01.000Z');
  });

  it('rejects approval records that do not match referenced lifecycle facts', () => {
    const repo = createRepo();
    repo.startToolCall(createToolCall({ toolCallId: 'tool-call-approval' }));
    repo.startToolCall(createToolCall({
      toolCallId: 'tool-call-other',
      providerToolCallId: 'provider-tool-call-other',
    }));
    repo.saveToolExecution(createToolExecution({
      toolExecutionId: 'tool-execution-approval',
      toolCallId: 'tool-call-approval',
    }));
    repo.saveToolExecution(createToolExecution({
      toolExecutionId: 'tool-execution-other',
      toolCallId: 'tool-call-other',
    }));

    const approval = createApprovalRequest({
      approvalRequestId: 'approval-request-lifecycle',
      toolCallId: 'tool-call-approval',
      toolExecutionId: 'tool-execution-approval',
      permissionDecisionId: undefined,
    });

    expect(() => repo.createApprovalRequest({
      ...approval,
      approvalRequestId: 'approval-request-tool-call-mismatch',
      toolCallId: 'tool-call-other',
    })).toThrow('Approval request toolCallId tool-call-other does not match tool execution toolCallId tool-call-approval');

    repo.createApprovalRequest(approval);
    const record = createApprovalRecord({
      approvalRequestId: 'approval-request-lifecycle',
      toolCallId: 'tool-call-approval',
      toolExecutionId: 'tool-execution-approval',
    });

    expect(() => repo.resolveApprovalRequest({
      ...record,
      approvalRecordId: 'approval-record-execution-mismatch',
      toolExecutionId: 'tool-execution-other',
    })).toThrow('Approval record toolExecutionId tool-execution-other does not match approval request toolExecutionId tool-execution-approval');
    expect(() => repo.resolveApprovalRequest({
      ...record,
      approvalRecordId: 'approval-record-call-mismatch',
      toolCallId: 'tool-call-other',
    })).toThrow('Approval record toolCallId tool-call-other does not match approval request toolCallId tool-call-approval');
  });
});

function currentDb(): Database.Database {
  if (!db) {
    throw new Error('Test database is not initialized.');
  }
  return db;
}

function tableNames(): string[] {
  return currentDb()
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => (row as { name: string }).name);
}

function createToolSource(overrides: Partial<ToolSource> = {}): ToolSource {
  return {
    sourceId: 'built_in',
    sourceKind: 'built_in',
    namespace: 'megumi',
    displayName: 'Built-in tools',
    configured: true,
    enabled: true,
    availabilityStatus: 'available',
    config: {},
    createdAt: '2026-06-14T00:00:00.000Z',
    updatedAt: '2026-06-14T00:00:00.000Z',
    ...overrides,
  };
}

function createToolRegistrySnapshot(overrides: Partial<ToolRegistrySnapshot> = {}): ToolRegistrySnapshot {
  const source = createToolSource();
  const snapshot: ToolRegistrySnapshot = {
    snapshotId: 'tool-registry-snapshot-1',
    runId: 'run-1',
    projectId: 'project-1',
    permissionMode: 'default',
    modelId: 'gpt-5',
    createdAt: '2026-06-14T00:00:00.000Z',
    registryVersion: 1,
    sourceVersionHash: 'source-version-hash-1',
    sourceEntries: [{
      sourceId: source.sourceId,
      sourceKind: source.sourceKind,
      namespace: source.namespace,
      displayName: source.displayName,
      configured: source.configured,
      enabled: source.enabled,
      availabilityStatus: source.availabilityStatus,
    }],
    entries: [{
      snapshotEntryId: 'snapshot-entry-read-file',
      snapshotId: 'tool-registry-snapshot-1',
      registrationId: 'registration-built-in-read-file',
      canonicalToolId: 'built_in:megumi:read_file',
      modelVisibleName: 'read_file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
      definition: {
        name: 'read_file',
        title: 'Read file',
        description: 'Read a normal project file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string' },
          },
        },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        availability: { status: 'available' },
      },
      effectiveStatus: 'available',
      exposedToModel: true,
      executionMode: 'parallel',
      createdAt: '2026-06-14T00:00:00.000Z',
    }],
  };
  return {
    ...snapshot,
    ...overrides,
  };
}

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolCallId: 'provider-tool-call-1',
    toolName: 'read_file',
    input: { path: 'src/index.ts' },
    inputPreview: inputPreview('src/index.ts'),
    status: 'created',
    createdAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function createToolExecution(overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'model-step-1',
    toolName: 'read_file',
    input: { path: 'src/index.ts' },
    inputPreview: inputPreview('src/index.ts'),
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    assistantMessageId: 'assistant-message-1',
    callOrder: 0,
    executionMode: 'parallel',
    continuationEmitted: false,
    status: 'awaitingApproval',
    requestedAt: '2026-05-20T00:00:02.000Z',
    ...overrides,
  };
}

function createPermissionDecision(overrides: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    permissionDecisionId: 'permission-decision-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    decision: 'allow',
    source: 'permission_mode',
    reason: 'Read-only project file access is allowed by default mode.',
    mode: 'default',
    classifierLabel: 'read_only',
    target: 'src/index.ts',
    capability: 'project_read',
    sideEffect: 'none',
    effectiveRiskLevel: 'low',
    requiredSandbox: { level: 'read_only_project', networkPolicy: 'deny' },
    evaluatedAt: '2026-05-20T00:00:01.000Z',
    ...overrides,
  };
}

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    permissionDecisionId: 'permission-decision-1',
    runId: 'run-1',
    stepId: 'model-step-1',
    toolName: 'read_file',
    capabilities: ['project_read'],
    riskLevel: 'low',
    title: 'Approve read',
    summary: 'Read src/index.ts',
    preview: { action: 'Read file', targets: [{ kind: 'file', label: 'src/index.ts' }] },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-20T00:00:03.000Z',
    ...overrides,
  };
}

function createApprovalRecord(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalRecordId: 'approval-record-1',
    approvalRequestId: 'approval-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    stepId: 'model-step-1',
    decision: 'approved',
    scope: 'once',
    decidedBy: 'user',
    decidedAt: '2026-05-20T00:00:05.000Z',
    ...overrides,
  };
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolCallId: 'tool-call-1',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { content: 'export {}' },
    textContent: 'export {}',
    redactionState: 'none',
    createdAt: '2026-05-20T00:00:04.000Z',
    ...overrides,
  };
}

function createToolObservation(overrides: Partial<ToolObservation> = {}): ToolObservation {
  return {
    observationId: 'observation-1',
    toolExecutionId: 'tool-execution-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    stepId: 'model-step-1',
    kind: 'text',
    isError: false,
    content: 'export {}',
    truncated: false,
    byteLength: 9,
    createdAt: '2026-05-20T00:00:05.000Z',
    ...overrides,
  };
}

function inputPreview(path: string) {
  return {
    summary: `Read ${path}`,
    targets: [{ kind: 'file' as const, label: path, sensitivity: 'normal' as const }],
    redactionState: 'none' as const,
  };
}

function toolIdentity() {
  return {
    registrySnapshotId: 'tool-registry-snapshot-1',
    snapshotEntryId: 'snapshot-entry-read-file',
    canonicalToolId: 'built_in:megumi:read_file',
    sourceId: 'built_in',
    namespace: 'megumi',
    sourceToolName: 'read_file',
    modelVisibleName: 'read_file',
  } as const;
}

function seedLifecycle(database: Database.Database): void {
  database.exec(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at, metadata_json
    ) VALUES (
      'project-1', 'Project 1', 'C:\\workspace\\project-1', 'c:\\workspace\\project-1',
      'available', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z',
      '2026-05-16T00:00:00.000Z', NULL
    );

    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at, metadata_json
    ) VALUES (
      'session-1', 'project-1', 'Tool session', 'active', NULL,
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', NULL, NULL
    );

    INSERT INTO agent_loop_runs (
      run_id, workspace_id, session_id, run_kind, user_message_id, assistant_message_id,
      base_run_id, base_message_id, base_entry_id, attempt_number, status, permission_mode,
      permission_snapshot_json, memory_recall_trace_id, started_at, completed_at, cancelled_at,
      error_json, created_at, metadata_json
    ) VALUES (
      'run-1', 'project-1', 'session-1', 'normal', NULL, NULL,
      NULL, NULL, NULL, 1, 'running', 'default',
      NULL, NULL, '2026-05-20T00:00:00.000Z', NULL, NULL,
      NULL, '2026-05-20T00:00:00.000Z', '{"goal":"Use tool"}'
    );

    INSERT INTO model_calls (
      model_call_id, run_id, call_order, provider_id, model_id, status,
      input_summary_json, context_snapshot_json, request_json, response_json, output_summary_json,
      token_usage_json, started_at, completed_at, error_json, metadata_json
    ) VALUES (
      'model-step-1', 'run-1', 1, 'openai-compatible', 'gpt-5', 'streaming',
      NULL, NULL, NULL, NULL, NULL, NULL, '2026-05-20T00:00:00.000Z', NULL, NULL,
      '{"stepId":"model-step-1"}'
    );
  `);
}

