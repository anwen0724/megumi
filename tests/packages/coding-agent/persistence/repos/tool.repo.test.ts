// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/coding-agent/persistence/schema/migrations';
import { ToolRepository } from '@megumi/coding-agent/persistence/repos/tool.repo';
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

function createRepo(): ToolRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  seedLifecycle(db);
  return new ToolRepository(db);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ToolRepository', () => {
  it('creates canonical tool call and execution tables without the legacy tool_uses table', () => {
    createRepo();

    expect(tableNames()).toContain('tool_calls');
    expect(tableNames()).toContain('tool_executions');
    expect(tableNames()).not.toContain('tool_uses');
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

  it('saves and reads tool sources', () => {
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
      SELECT source_id, source_kind, namespace, enabled, availability_status, config_json, source_json
      FROM tool_sources
      WHERE source_id = 'test_external'
    `).get() as {
      source_id: string;
      source_kind: string;
      namespace: string;
      enabled: number;
      availability_status: string;
      config_json: string;
      source_json: string;
    };
    expect(row).toMatchObject({
      source_id: 'test_external',
      source_kind: 'external_test',
      namespace: 'demo',
      enabled: 0,
      availability_status: 'available',
    });
    expect(JSON.parse(row.config_json)).toEqual({});
    expect(JSON.parse(row.source_json)).toEqual(source);
  });

  it('saves and reads run-level registry snapshots with entries', () => {
    const repo = createRepo();
    const source = createToolSource();
    const snapshot = createToolRegistrySnapshot();

    repo.saveToolSource(source);
    repo.saveToolRegistrySnapshot(snapshot);

    expect(repo.getToolRegistrySnapshot('tool-registry-snapshot-1')).toEqual(snapshot);
    expect(repo.getToolRegistrySnapshotByRun('run-1')).toEqual(snapshot);
    expect(repo.listToolRegistrySnapshotEntries('tool-registry-snapshot-1')).toEqual(snapshot.entries);

    const snapshotRow = currentDb().prepare(`
      SELECT run_id, project_id, source_entries_json, snapshot_json
      FROM tool_registry_snapshots
      WHERE snapshot_id = 'tool-registry-snapshot-1'
    `).get() as {
      run_id: string;
      project_id: string;
      source_entries_json: string;
      snapshot_json: string;
    };
    expect(snapshotRow.run_id).toBe('run-1');
    expect(snapshotRow.project_id).toBe('project-1');
    expect(JSON.parse(snapshotRow.source_entries_json)).toEqual(snapshot.sourceEntries);
    expect(JSON.parse(snapshotRow.snapshot_json)).toEqual(snapshot);

    const entryRow = currentDb().prepare(`
      SELECT model_visible_name, canonical_tool_id, entry_json
      FROM tool_registry_snapshot_entries
      WHERE snapshot_entry_id = 'snapshot-entry-read-file'
    `).get() as {
      model_visible_name: string;
      canonical_tool_id: string;
      entry_json: string;
    };
    expect(entryRow.model_visible_name).toBe('read_file');
    expect(entryRow.canonical_tool_id).toBe('built_in:megumi:read_file');
    expect(JSON.parse(entryRow.entry_json)).toEqual(snapshot.entries[0]);
  });

  it('saves and reads model-side tool calls and host tool executions', () => {
    const repo = createRepo();
    const toolCall = createToolCall();
    const execution = createToolExecution();

    repo.saveToolCall(toolCall);
    repo.saveToolExecution(execution);

    expect(repo.getToolCall('tool-call-1')).toEqual(toolCall);
    expect(repo.listToolCallsByRun('run-1')).toEqual([toolCall]);
    expect(repo.getToolExecution('tool-execution-1')).toEqual(execution);
    expect(repo.listToolExecutionsByRun('run-1')).toEqual([execution]);

    const callRow = currentDb().prepare(`
      SELECT tool_call_id, provider_tool_call_id, model_step_id, tool_call_json
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-1'
    `).get() as {
      tool_call_id: string;
      provider_tool_call_id: string;
      model_step_id: string;
      tool_call_json: string;
    };
    expect(callRow).toMatchObject({
      tool_call_id: 'tool-call-1',
      provider_tool_call_id: 'provider-tool-call-1',
      model_step_id: 'model-step-1',
    });
    expect(JSON.parse(callRow.tool_call_json)).toEqual(toolCall);

    const executionRow = currentDb().prepare(`
      SELECT tool_execution_id, tool_call_id, status, tool_execution_json
      FROM tool_executions
      WHERE tool_execution_id = 'tool-execution-1'
    `).get() as {
      tool_execution_id: string;
      tool_call_id: string;
      status: string;
      tool_execution_json: string;
    };
    expect(executionRow).toMatchObject({
      tool_execution_id: 'tool-execution-1',
      tool_call_id: 'tool-call-1',
      status: 'awaitingApproval',
    });
    expect(JSON.parse(executionRow.tool_execution_json)).toEqual(execution);
  });

  it('stores formal source identity columns on tool lifecycle facts', () => {
    const repo = createRepo();
    const source = createToolSource();
    const snapshot = createToolRegistrySnapshot();
    const identity = {
      registrySnapshotId: 'tool-registry-snapshot-1',
      snapshotEntryId: 'snapshot-entry-read-file',
      modelVisibleName: 'read_file',
      canonicalToolId: 'built_in:megumi:read_file',
      sourceId: 'built_in',
      namespace: 'megumi',
      sourceToolName: 'read_file',
    } as const;

    repo.saveToolSource(source);
    repo.saveToolRegistrySnapshot(snapshot);
    repo.saveToolCall(createToolCall(identity));
    repo.saveToolExecution(createToolExecution(identity));
    repo.savePermissionDecision(createPermissionDecision(identity));
    repo.saveApprovalRequest(createApprovalRequest(identity));

    for (const [tableName, idColumn, idValue] of [
      ['tool_calls', 'tool_call_id', 'tool-call-1'],
      ['tool_executions', 'tool_execution_id', 'tool-execution-1'],
      ['permission_decisions', 'permission_decision_id', 'permission-decision-1'],
      ['approval_requests', 'approval_request_id', 'approval-1'],
    ] as const) {
      const row = currentDb().prepare(`
        SELECT
          registry_snapshot_id,
          snapshot_entry_id,
          model_visible_name,
          canonical_tool_id,
          source_id,
          namespace,
          source_tool_name
        FROM ${tableName}
        WHERE ${idColumn} = ?
      `).get(idValue) as Record<string, string>;

      expect(row).toMatchObject({
        registry_snapshot_id: 'tool-registry-snapshot-1',
        snapshot_entry_id: 'snapshot-entry-read-file',
        model_visible_name: 'read_file',
        canonical_tool_id: 'built_in:megumi:read_file',
        source_id: 'built_in',
        namespace: 'megumi',
        source_tool_name: 'read_file',
      });
    }

    for (const [tableName, idColumn, idValue] of [
      ['tool_calls', 'tool_call_id', 'tool-call-1'],
      ['tool_executions', 'tool_execution_id', 'tool-execution-1'],
      ['approval_requests', 'approval_request_id', 'approval-1'],
    ] as const) {
      const row = currentDb().prepare(`
        SELECT tool_name, model_visible_name
        FROM ${tableName}
        WHERE ${idColumn} = ?
      `).get(idValue) as { tool_name: string; model_visible_name: string };
      expect(row.tool_name).toBe(row.model_visible_name);
    }
  });

  it('updates durable columns on upsert and keeps canonical list ordering in sync', () => {
    const repo = createRepo();
    const toolCall = createToolCall({ toolCallId: 'tool-call-upsert' });
    const updatedToolCall = createToolCall({
      toolCallId: 'tool-call-upsert',
      modelStepId: 'model-step-2',
      providerToolCallId: 'provider-tool-call-updated',
      input: { path: 'src/updated.ts' },
      inputPreview: {
        summary: 'Read src/updated.ts',
        targets: [{ kind: 'file', label: 'src/updated.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      status: 'completed',
      createdAt: '2026-05-20T00:00:10.000Z',
      completedAt: '2026-05-20T00:00:11.000Z',
    });

    repo.saveToolCall(toolCall);
    repo.saveToolCall(updatedToolCall);

    const toolCallRow = currentDb().prepare(`
      SELECT model_step_id, provider_tool_call_id, input_json, input_preview_json, status, created_at, completed_at
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-upsert'
    `).get() as {
      model_step_id: string;
      provider_tool_call_id: string;
      input_json: string;
      input_preview_json: string;
      status: string;
      created_at: string;
      completed_at: string;
    };
    expect(toolCallRow).toMatchObject({
      model_step_id: 'model-step-2',
      provider_tool_call_id: 'provider-tool-call-updated',
      status: 'completed',
      created_at: '2026-05-20T00:00:10.000Z',
      completed_at: '2026-05-20T00:00:11.000Z',
    });
    expect(JSON.parse(toolCallRow.input_json)).toEqual({ path: 'src/updated.ts' });
    expect(JSON.parse(toolCallRow.input_preview_json).summary).toBe('Read src/updated.ts');

    const laterExecution = createToolExecution({
      toolExecutionId: 'tool-execution-later',
      toolCallId: 'tool-call-later',
      callOrder: 1,
      requestedAt: '2026-05-20T00:00:20.000Z',
    });
    const execution = createToolExecution({
      toolExecutionId: 'tool-execution-upsert',
      toolCallId: 'tool-call-upsert',
      requestedAt: '2026-05-20T00:00:15.000Z',
    });
    const updatedExecution = createToolExecution({
      toolExecutionId: 'tool-execution-upsert',
      toolCallId: 'tool-call-upsert',
      actionId: 'action-1',
      capabilities: ['project_read', 'command_run'],
      riskLevel: 'medium',
      sideEffect: 'execute_command',
      resultPreview: 'updated preview',
      status: 'running',
      requestedAt: '2026-05-20T00:00:14.000Z',
    });
    seedRunAction(currentDb());
    repo.saveToolCall(createToolCall({
      toolCallId: 'tool-call-later',
      providerToolCallId: 'provider-tool-call-later',
    }));
    repo.saveToolExecution(laterExecution);
    repo.saveToolExecution(execution);
    repo.saveToolExecution(updatedExecution);

    const executionRow = currentDb().prepare(`
      SELECT action_id, capabilities_json, risk_level, side_effect, result_preview, status, requested_at
      FROM tool_executions
      WHERE tool_execution_id = 'tool-execution-upsert'
    `).get() as {
      action_id: string;
      capabilities_json: string;
      risk_level: string;
      side_effect: string;
      result_preview: string;
      status: string;
      requested_at: string;
    };
    expect(executionRow).toMatchObject({
      action_id: 'action-1',
      risk_level: 'medium',
      side_effect: 'execute_command',
      result_preview: 'updated preview',
      status: 'running',
      requested_at: '2026-05-20T00:00:14.000Z',
    });
    expect(JSON.parse(executionRow.capabilities_json)).toEqual(['project_read', 'command_run']);
    expect(repo.listToolExecutionsByRun('run-1').map((item) => item.toolExecutionId)).toEqual([
      'tool-execution-upsert',
      'tool-execution-later',
    ]);
  });

  it('stores decisions, approvals, results, and observations against canonical ids', () => {
    const repo = createRepo();
    const toolCall = createToolCall();
    const execution = createToolExecution();
    const decision = createPermissionDecision();
    const approval = createApprovalRequest();
    const record = createApprovalRecord();
    const result = createToolResult();
    const observation = createToolObservation();

    repo.saveToolCall(toolCall);
    repo.saveToolExecution(execution);
    repo.savePermissionDecision(decision);
    repo.saveApprovalRequest(approval);
    repo.saveApprovalRecord(record);
    repo.saveToolResult(result);
    repo.saveToolObservation(observation);

    expect(repo.listPermissionDecisionsByToolCall('tool-call-1')).toEqual([decision]);
    expect(repo.getApprovalRequest('approval-1')).toEqual(approval);
    expect(repo.listToolResultsByToolCall('tool-call-1')).toEqual([result]);
    expect(repo.listToolObservationsByToolExecution('tool-execution-1')).toEqual([observation]);

    expect(currentDb().prepare(`
      SELECT tool_call_id, tool_execution_id
      FROM permission_decisions
      WHERE permission_decision_id = 'permission-decision-1'
    `).get()).toEqual({
      tool_call_id: 'tool-call-1',
      tool_execution_id: 'tool-execution-1',
    });
    expect(currentDb().prepare(`
      SELECT tool_call_id, tool_execution_id
      FROM tool_results
      WHERE tool_result_id = 'tool-result-1'
    `).get()).toEqual({
      tool_call_id: 'tool-call-1',
      tool_execution_id: 'tool-execution-1',
    });
    expect(currentDb().prepare(`
      SELECT tool_execution_id
      FROM tool_observations
      WHERE observation_id = 'observation-1'
    `).get()).toEqual({
      tool_execution_id: 'tool-execution-1',
    });
  });

  it('persists execution records with decision, observation, and model input submission marker', () => {
    const repo = createRepo();
    const record = createToolExecution({
      assistantMessageId: 'assistant-message:1',
      callOrder: 0,
      status: 'succeeded',
      decision: {
        outcome: 'allow',
        reasonCode: 'BUILTIN_READ_ALLOWED',
        reason: 'Read-only built-in tool is allowed.',
        executionClass: 'readOnly',
        executionMode: 'parallel',
      },
      observation: createToolObservation({ content: 'file content' }),
      continuationEmitted: false,
    });

    repo.saveToolCall(createToolCall());
    repo.saveToolExecution(record);

    expect(repo.getToolExecution(record.toolExecutionId)).toMatchObject({
      assistantMessageId: 'assistant-message:1',
      callOrder: 0,
      status: 'succeeded',
      continuationEmitted: false,
    });
    expect(repo.getToolExecution(record.toolExecutionId)?.decision?.reasonCode).toBe('BUILTIN_READ_ALLOWED');
    expect(repo.getToolExecution(record.toolExecutionId)?.observation?.content).toBe('file content');
  });

  it('lists conceptual batch records by callOrder', () => {
    const repo = createRepo();
    repo.saveToolCall(createToolCall({ toolCallId: 'call:2', providerToolCallId: 'provider-call:2' }));
    repo.saveToolCall(createToolCall({ toolCallId: 'call:0', providerToolCallId: 'provider-call:0' }));
    repo.saveToolCall(createToolCall({ toolCallId: 'call:1', providerToolCallId: 'provider-call:1' }));
    repo.saveToolExecution(createToolExecution({ toolExecutionId: 'exec:2', toolCallId: 'call:2', callOrder: 2 }));
    repo.saveToolExecution(createToolExecution({ toolExecutionId: 'exec:0', toolCallId: 'call:0', callOrder: 0 }));
    repo.saveToolExecution(createToolExecution({ toolExecutionId: 'exec:1', toolCallId: 'call:1', callOrder: 1 }));

    const records = repo.listToolExecutionsByAssistantMessage({
      runId: 'run-1',
      assistantMessageId: 'assistant-message-1',
    });

    expect(records.map((record) => record.callOrder)).toEqual([0, 1, 2]);
  });

  it('marks tool results submitted to model input without changing terminal execution outcome', () => {
    const repo = createRepo();
    repo.saveToolCall(createToolCall());
    repo.saveToolExecution(createToolExecution({ status: 'failed', continuationEmitted: false }));

    repo.markToolResultsSubmittedToModelInput({
      toolExecutionIds: ['tool-execution-1'],
      emittedAt: '2026-06-15T00:00:01.000Z',
    });

    const record = repo.getToolExecution('tool-execution-1');
    expect(record?.status).toBe('failed');
    expect(record?.continuationEmitted).toBe(true);
    expect(record?.metadata?.continuationEmittedAt).toBe('2026-06-15T00:00:01.000Z');
  });

  it('lists and updates pending approval and tool execution facts by run', () => {
    const repo = createRepo();
    repo.saveToolCall({
      toolCallId: 'tool-call-pending',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolCallId: 'provider-tool-call-pending',
      toolName: 'read_file',
      input: { path: 'package.json' },
      inputPreview: {
        summary: 'read_file',
        targets: [],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-06-14T00:00:00.000Z',
    });
    repo.saveToolExecution({
      toolExecutionId: 'tool-execution-pending',
      toolCallId: 'tool-call-pending',
      runId: 'run-1',
      stepId: 'step-1',
      assistantMessageId: 'assistant-message-1',
      callOrder: 0,
      toolName: 'read_file',
      input: { path: 'package.json' },
      inputPreview: {
        summary: 'read_file',
        targets: [],
        redactionState: 'none',
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'awaitingApproval',
      requestedAt: '2026-06-14T00:00:00.000Z',
      continuationEmitted: false,
    });
    repo.saveApprovalRequest({
      approvalRequestId: 'approval-pending',
      toolCallId: 'tool-call-pending',
      toolExecutionId: 'tool-execution-pending',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      capabilities: ['project_read'],
      riskLevel: 'low',
      title: 'Approve read_file',
      summary: 'Approval required.',
      preview: { action: 'read_file', targets: [] },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-06-14T00:00:00.000Z',
    });

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

  it('rejects approval requests and records that do not match referenced lifecycle facts', () => {
    const repo = createRepo();
    seedSecondRunStep(currentDb());
    const toolCall = createToolCall({ toolCallId: 'tool-call-approval' });
    const otherToolCall = createToolCall({
      toolCallId: 'tool-call-other',
      modelStepId: 'model-step-2',
      providerToolCallId: 'provider-tool-call-other',
    });
    const execution = createToolExecution({
      toolExecutionId: 'tool-execution-approval',
      toolCallId: 'tool-call-approval',
    });
    const otherExecution = createToolExecution({
      toolExecutionId: 'tool-execution-other',
      toolCallId: 'tool-call-other',
    });
    const decision = createPermissionDecision({
      permissionDecisionId: 'permission-approval',
      toolCallId: 'tool-call-approval',
      toolExecutionId: 'tool-execution-approval',
    });
    const otherDecision = createPermissionDecision({
      permissionDecisionId: 'permission-other',
      toolCallId: 'tool-call-other',
      toolExecutionId: 'tool-execution-other',
    });
    const approval = createApprovalRequest({
      approvalRequestId: 'approval-request-lifecycle',
      toolCallId: 'tool-call-approval',
      toolExecutionId: 'tool-execution-approval',
      permissionDecisionId: 'permission-approval',
    });

    repo.saveToolCall(toolCall);
    repo.saveToolCall(otherToolCall);
    repo.saveToolExecution(execution);
    repo.saveToolExecution(otherExecution);
    repo.savePermissionDecision(decision);
    repo.savePermissionDecision(otherDecision);

    expect(() => repo.saveApprovalRequest({
      ...approval,
      approvalRequestId: 'approval-request-tool-call-mismatch',
      toolCallId: 'tool-call-other',
    })).toThrow('Approval request toolCallId tool-call-other does not match tool execution toolCallId tool-call-approval');
    expect(() => repo.saveApprovalRequest({
      ...approval,
      approvalRequestId: 'approval-request-run-mismatch',
      runId: 'run-2',
    })).toThrow('Approval request runId run-2 does not match tool execution runId run-1');
    expect(() => repo.saveApprovalRequest({
      ...approval,
      approvalRequestId: 'approval-request-step-mismatch',
      stepId: 'step-2',
    })).toThrow('Approval request stepId step-2 does not match tool execution stepId step-1');
    expect(() => repo.saveApprovalRequest({
      ...approval,
      approvalRequestId: 'approval-request-decision-tool-call-mismatch',
      permissionDecisionId: 'permission-other',
    })).toThrow('Approval request permissionDecisionId permission-other belongs to toolCallId tool-call-other, not tool-call-approval');

    repo.saveApprovalRequest(approval);
    const record = createApprovalRecord({
      approvalRequestId: 'approval-request-lifecycle',
      toolCallId: 'tool-call-approval',
      toolExecutionId: 'tool-execution-approval',
    });
    repo.saveApprovalRecord(record);

    expect(() => repo.saveApprovalRecord({
      ...record,
      approvalRecordId: 'approval-record-execution-mismatch',
      toolExecutionId: 'tool-execution-other',
    })).toThrow('Approval record toolExecutionId tool-execution-other does not match approval request toolExecutionId tool-execution-approval');
    expect(() => repo.saveApprovalRecord({
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
    stepId: 'step-1',
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
    stepId: 'step-1',
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
    stepId: 'step-1',
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
    stepId: 'step-1',
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

function seedLifecycle(database: Database.Database): void {
  database.prepare(`
    INSERT INTO projects (project_id, name, repo_path, repo_path_key, status, created_at, last_opened_at)
    VALUES ('project-1', 'Project 1', 'C:\\workspace\\project-1', 'c:\\workspace\\project-1', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO sessions (session_id, title, status, created_at, updated_at)
    VALUES ('session-1', 'Tool session', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO runs (run_id, session_id, permission_mode, goal, status, created_at)
    VALUES ('run-1', 'session-1', 'default', 'Use tool', 'running', '2026-05-20T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO run_steps (step_id, run_id, kind, status)
    VALUES ('step-1', 'run-1', 'model', 'running')
  `).run();
  database.prepare(`
    INSERT INTO model_steps (
      model_step_id, run_id, step_id, provider_id, model_id, status, started_at, model_step_json
    ) VALUES (
      'model-step-1',
      'run-1',
      'step-1',
      'openai-compatible',
      'gpt-5',
      'streaming',
      '2026-05-20T00:00:00.000Z',
      '{"modelStepId":"model-step-1","runId":"run-1","stepId":"step-1","providerId":"openai-compatible","modelId":"gpt-5","status":"streaming","startedAt":"2026-05-20T00:00:00.000Z"}'
    )
  `).run();
  database.prepare(`
    INSERT INTO model_steps (
      model_step_id, run_id, step_id, provider_id, model_id, status, started_at, model_step_json
    ) VALUES (
      'model-step-2',
      'run-1',
      'step-1',
      'openai-compatible',
      'gpt-5',
      'streaming',
      '2026-05-20T00:00:10.000Z',
      '{"modelStepId":"model-step-2","runId":"run-1","stepId":"step-1","providerId":"openai-compatible","modelId":"gpt-5","status":"streaming","startedAt":"2026-05-20T00:00:10.000Z"}'
    )
  `).run();
}

function seedRunAction(database: Database.Database): void {
  database.prepare(`
    INSERT INTO run_actions (action_id, run_id, step_id, kind, status, requested_at)
    VALUES ('action-1', 'run-1', 'step-1', 'tool_call', 'requested', '2026-05-20T00:00:14.000Z')
  `).run();
}

function seedSecondRunStep(database: Database.Database): void {
  database.prepare(`
    INSERT INTO runs (run_id, session_id, permission_mode, goal, status, created_at)
    VALUES ('run-2', 'session-1', 'default', 'Use another tool', 'running', '2026-05-20T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO run_steps (step_id, run_id, kind, status)
    VALUES ('step-2', 'run-2', 'model', 'running')
  `).run();
}

