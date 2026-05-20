// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import type {
  ApprovalRecord,
  ApprovalRequest,
  PermissionDecision,
  ToolCall,
  ToolResult,
  ToolUse,
} from '@megumi/shared/tool-contracts';

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
  it('saves and reads tool use execution facts', () => {
    const repo = createRepo();
    const toolUse: ToolUse = {
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      modelStepId: 'model-step-1',
      providerToolUseId: 'provider-tool-use-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      status: 'created',
      createdAt: '2026-05-20T00:00:00.000Z',
    };
    const decision: PermissionDecision = {
      permissionDecisionId: 'permission-decision-1',
      toolUseId: 'tool-use-1',
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
    };
    const toolCall: ToolCall = {
      toolCallId: 'tool-call-1',
      toolUseId: 'tool-use-1',
      runId: 'run-1',
      stepId: 'step-1',
      toolName: 'read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      policyDecision: decision,
      status: 'requested',
      requestedAt: '2026-05-20T00:00:02.000Z',
    };
    const approval: ApprovalRequest = {
      approvalRequestId: 'approval-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
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
    };
    const result: ToolResult = {
      toolResultId: 'tool-result-1',
      toolUseId: 'tool-use-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      kind: 'success',
      structuredContent: { content: 'export {}' },
      textContent: 'export {}',
      redactionState: 'none',
      createdAt: '2026-05-20T00:00:04.000Z',
    };

    repo.saveToolUse(toolUse);
    repo.savePermissionDecision(decision);
    repo.saveToolCall(toolCall);
    repo.saveApprovalRequest(approval);
    repo.saveToolResult(result);

    expect(repo.getToolUse('tool-use-1')).toMatchObject({ toolName: 'read_file', status: 'created' });
    expect(repo.listToolUsesByRun('run-1')).toEqual([toolUse]);
    expect(repo.getToolCall('tool-call-1')).toMatchObject({
      toolUseId: 'tool-use-1',
      toolName: 'read_file',
      capabilities: ['project_read'],
      riskLevel: 'low',
      sideEffect: 'none',
    });
    expect(repo.listPermissionDecisionsByToolUse('tool-use-1')).toEqual([decision]);
    expect(repo.getApprovalRequest('approval-1')?.toolUseId).toBe('tool-use-1');
    expect(repo.listToolResultsByToolUse('tool-use-1')).toEqual([result]);
  });

  it('updates durable columns on upsert and keeps list ordering in sync', () => {
    const repo = createRepo();
    const toolUse = createToolUse({ toolUseId: 'tool-use-upsert' });
    const updatedToolUse = createToolUse({
      toolUseId: 'tool-use-upsert',
      modelStepId: 'model-step-2',
      providerToolUseId: 'provider-tool-use-updated',
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

    repo.saveToolUse(toolUse);
    repo.saveToolUse(updatedToolUse);

    const toolUseRow = currentDb().prepare(`
      SELECT model_step_id, provider_tool_use_id, input_json, input_preview_json, status, created_at, completed_at
      FROM tool_uses
      WHERE tool_use_id = 'tool-use-upsert'
    `).get() as {
      model_step_id: string;
      provider_tool_use_id: string;
      input_json: string;
      input_preview_json: string;
      status: string;
      created_at: string;
      completed_at: string;
    };
    expect(toolUseRow).toMatchObject({
      model_step_id: 'model-step-2',
      provider_tool_use_id: 'provider-tool-use-updated',
      status: 'completed',
      created_at: '2026-05-20T00:00:10.000Z',
      completed_at: '2026-05-20T00:00:11.000Z',
    });
    expect(JSON.parse(toolUseRow.input_json)).toEqual({ path: 'src/updated.ts' });
    expect(JSON.parse(toolUseRow.input_preview_json).summary).toBe('Read src/updated.ts');

    const decision = createPermissionDecision({ permissionDecisionId: 'permission-upsert', toolUseId: 'tool-use-upsert' });
    const updatedDecision = createPermissionDecision({
      permissionDecisionId: 'permission-upsert',
      toolUseId: 'tool-use-upsert',
      reason: 'Updated decision reason.',
      target: 'src/updated.ts',
      evaluatedAt: '2026-05-20T00:00:12.000Z',
    });
    repo.savePermissionDecision(decision);
    repo.savePermissionDecision(updatedDecision);
    const decisionRow = currentDb().prepare(`
      SELECT reason, target, evaluated_at
      FROM permission_decisions
      WHERE permission_decision_id = 'permission-upsert'
    `).get() as { reason: string; target: string; evaluated_at: string };
    expect(decisionRow).toEqual({
      reason: 'Updated decision reason.',
      target: 'src/updated.ts',
      evaluated_at: '2026-05-20T00:00:12.000Z',
    });

    const toolCall = createToolCall({
      toolCallId: 'tool-call-upsert',
      toolUseId: 'tool-use-upsert',
      requestedAt: '2026-05-20T00:00:20.000Z',
    });
    const earlierToolCall = createToolCall({
      toolCallId: 'tool-call-earlier',
      toolUseId: 'tool-use-upsert',
      requestedAt: '2026-05-20T00:00:15.000Z',
    });
    const updatedToolCall = createToolCall({
      toolCallId: 'tool-call-upsert',
      toolUseId: 'tool-use-upsert',
      actionId: 'action-1',
      inputPreview: {
        summary: 'Read src/updated.ts',
        targets: [{ kind: 'file', label: 'src/updated.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['project_read', 'command_run'],
      riskLevel: 'medium',
      sideEffect: 'execute_command',
      resultPreview: 'updated preview',
      status: 'running',
      requestedAt: '2026-05-20T00:00:14.000Z',
    });
    seedRunAction(currentDb());
    repo.saveToolCall(toolCall);
    repo.saveToolCall(earlierToolCall);
    repo.saveToolCall(updatedToolCall);

    const toolCallRow = currentDb().prepare(`
      SELECT action_id, input_preview_json, capabilities_json, risk_level, side_effect, result_preview, status, requested_at
      FROM tool_calls
      WHERE tool_call_id = 'tool-call-upsert'
    `).get() as {
      action_id: string;
      input_preview_json: string;
      capabilities_json: string;
      risk_level: string;
      side_effect: string;
      result_preview: string;
      status: string;
      requested_at: string;
    };
    expect(toolCallRow).toMatchObject({
      action_id: 'action-1',
      risk_level: 'medium',
      side_effect: 'execute_command',
      result_preview: 'updated preview',
      status: 'running',
      requested_at: '2026-05-20T00:00:14.000Z',
    });
    expect(JSON.parse(toolCallRow.input_preview_json).summary).toBe('Read src/updated.ts');
    expect(JSON.parse(toolCallRow.capabilities_json)).toEqual(['project_read', 'command_run']);
    expect(repo.listToolCallsByRun('run-1').map((call) => call.toolCallId)).toEqual([
      'tool-call-upsert',
      'tool-call-earlier',
    ]);

    const approval = createApprovalRequest({
      approvalRequestId: 'approval-upsert',
      toolUseId: 'tool-use-upsert',
      toolCallId: 'tool-call-upsert',
      permissionDecisionId: 'permission-upsert',
      createdAt: '2026-05-20T00:00:21.000Z',
    });
    const updatedApproval = createApprovalRequest({
      approvalRequestId: 'approval-upsert',
      toolUseId: 'tool-use-upsert',
      toolCallId: 'tool-call-upsert',
      permissionDecisionId: 'permission-upsert',
      toolName: 'list_files',
      requestedScope: 'run',
      riskLevel: 'medium',
      status: 'approved',
      createdAt: '2026-05-20T00:00:22.000Z',
      expiresAt: '2026-05-20T00:05:22.000Z',
      resolvedAt: '2026-05-20T00:00:23.000Z',
    });
    repo.saveApprovalRequest(approval);
    repo.saveApprovalRequest(updatedApproval);

    const approvalRow = currentDb().prepare(`
      SELECT run_id, step_id, tool_name, requested_scope, risk_level, status, created_at, expires_at, resolved_at
      FROM approval_requests
      WHERE approval_request_id = 'approval-upsert'
    `).get() as {
      run_id: string;
      step_id: string;
      tool_name: string;
      requested_scope: string;
      risk_level: string;
      status: string;
      created_at: string;
      expires_at: string;
      resolved_at: string;
    };
    expect(approvalRow).toEqual({
      run_id: 'run-1',
      step_id: 'step-1',
      tool_name: 'list_files',
      requested_scope: 'run',
      risk_level: 'medium',
      status: 'approved',
      created_at: '2026-05-20T00:00:22.000Z',
      expires_at: '2026-05-20T00:05:22.000Z',
      resolved_at: '2026-05-20T00:00:23.000Z',
    });

    const result = createToolResult({
      toolResultId: 'tool-result-upsert',
      toolUseId: 'tool-use-upsert',
      toolCallId: 'tool-call-upsert',
      createdAt: '2026-05-20T00:00:30.000Z',
    });
    const earlierResult = createToolResult({
      toolResultId: 'tool-result-earlier',
      toolUseId: 'tool-use-upsert',
      toolCallId: 'tool-call-earlier',
      createdAt: '2026-05-20T00:00:25.000Z',
    });
    const updatedResult = createToolResult({
      toolResultId: 'tool-result-upsert',
      toolUseId: 'tool-use-upsert',
      toolCallId: 'tool-call-upsert',
      kind: 'tool_error',
      textContent: 'updated error',
      structuredContent: { error: 'updated error' },
      redactionState: 'redacted',
      createdAt: '2026-05-20T00:00:24.000Z',
    });
    repo.saveToolResult(result);
    repo.saveToolResult(earlierResult);
    repo.saveToolResult(updatedResult);

    const resultRow = currentDb().prepare(`
      SELECT tool_use_id, tool_call_id, run_id, kind, text_content, structured_content_json, redaction_state, created_at
      FROM tool_results
      WHERE tool_result_id = 'tool-result-upsert'
    `).get() as {
      tool_use_id: string;
      tool_call_id: string;
      run_id: string;
      kind: string;
      text_content: string;
      structured_content_json: string;
      redaction_state: string;
      created_at: string;
    };
    expect(resultRow).toMatchObject({
      tool_use_id: 'tool-use-upsert',
      tool_call_id: 'tool-call-upsert',
      run_id: 'run-1',
      kind: 'tool_error',
      text_content: 'updated error',
      redaction_state: 'redacted',
      created_at: '2026-05-20T00:00:24.000Z',
    });
    expect(JSON.parse(resultRow.structured_content_json)).toEqual({ error: 'updated error' });
    expect(repo.listToolResultsByToolUse('tool-use-upsert').map((item) => item.toolResultId)).toEqual([
      'tool-result-upsert',
      'tool-result-earlier',
    ]);
  });

  it('persists approval records and rejects records for a different tool call', () => {
    const repo = createRepo();
    const toolUse = createToolUse({ toolUseId: 'tool-use-approval' });
    const decision = createPermissionDecision({ permissionDecisionId: 'permission-approval', toolUseId: 'tool-use-approval' });
    const toolCall = createToolCall({ toolCallId: 'tool-call-approval', toolUseId: 'tool-use-approval' });
    const otherToolCall = createToolCall({ toolCallId: 'tool-call-other', toolUseId: 'tool-use-approval' });
    const approval = createApprovalRequest({
      approvalRequestId: 'approval-record-request',
      toolUseId: 'tool-use-approval',
      toolCallId: 'tool-call-approval',
      permissionDecisionId: 'permission-approval',
    });
    const record: ApprovalRecord = {
      approvalRecordId: 'approval-record-1',
      approvalRequestId: 'approval-record-request',
      toolCallId: 'tool-call-approval',
      runId: 'run-1',
      stepId: 'step-1',
      decision: 'approved',
      scope: 'once',
      decidedBy: 'user',
      decidedAt: '2026-05-20T00:00:05.000Z',
    };

    repo.saveToolUse(toolUse);
    repo.savePermissionDecision(decision);
    repo.saveToolCall(toolCall);
    repo.saveToolCall(otherToolCall);
    repo.saveApprovalRequest(approval);
    repo.saveApprovalRecord(record);

    const row = currentDb().prepare(`
      SELECT approval_request_id, tool_use_id, tool_call_id, decision, scope, decided_by, decided_at, record_json
      FROM approval_records
      WHERE approval_record_id = 'approval-record-1'
    `).get() as {
      approval_request_id: string;
      tool_use_id: string;
      tool_call_id: string;
      decision: string;
      scope: string;
      decided_by: string;
      decided_at: string;
      record_json: string;
    };
    expect(row).toMatchObject({
      approval_request_id: 'approval-record-request',
      tool_use_id: 'tool-use-approval',
      tool_call_id: 'tool-call-approval',
      decision: 'approved',
      scope: 'once',
      decided_by: 'user',
      decided_at: '2026-05-20T00:00:05.000Z',
    });
    expect(JSON.parse(row.record_json)).toEqual(record);

    expect(() => repo.saveApprovalRecord({
      ...record,
      approvalRecordId: 'approval-record-mismatch',
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

function createToolUse(overrides: Partial<ToolUse> = {}): ToolUse {
  return {
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    modelStepId: 'model-step-1',
    providerToolUseId: 'provider-tool-use-1',
    toolName: 'read_file',
    input: { path: 'src/index.ts' },
    inputPreview: {
      summary: 'Read src/index.ts',
      targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
      redactionState: 'none',
    },
    status: 'created',
    createdAt: '2026-05-20T00:00:00.000Z',
    ...overrides,
  };
}

function createPermissionDecision(overrides: Partial<PermissionDecision> = {}): PermissionDecision {
  return {
    permissionDecisionId: 'permission-decision-1',
    toolUseId: 'tool-use-1',
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

function createToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: 'tool-use-1',
    runId: 'run-1',
    stepId: 'step-1',
    toolName: 'read_file',
    input: { path: 'src/index.ts' },
    inputPreview: {
      summary: 'Read src/index.ts',
      targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
      redactionState: 'none',
    },
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'requested',
    requestedAt: '2026-05-20T00:00:02.000Z',
    ...overrides,
  };
}

function createApprovalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolUseId: 'tool-use-1',
    toolCallId: 'tool-call-1',
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

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolUseId: 'tool-use-1',
    toolCallId: 'tool-call-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { content: 'export {}' },
    textContent: 'export {}',
    redactionState: 'none',
    createdAt: '2026-05-20T00:00:04.000Z',
    ...overrides,
  };
}

function seedLifecycle(database: Database.Database): void {
  database.prepare(`
    INSERT INTO sessions (session_id, title, status, created_at, updated_at)
    VALUES ('session-1', 'Tool session', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO runs (run_id, session_id, mode, goal, status, created_at)
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
