// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import type {
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
      toolCallId: 'tool-call-1',
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
    repo.saveToolCall(toolCall);
    repo.savePermissionDecision(decision);
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
});

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
}
