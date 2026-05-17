// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import type {
  ApprovalRequest,
  ToolCall,
  ToolObservation,
  ToolPolicyDecision,
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
  it('saves and reads tool call, policy decision, approval request, and observation summaries', () => {
    const repo = createRepo();
    const toolCall: ToolCall = {
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      toolName: 'workspace_read_file',
      input: { path: 'src/index.ts' },
      inputPreview: {
        summary: 'Read src/index.ts',
        targets: [{ kind: 'file', label: 'src/index.ts', sensitivity: 'normal' }],
        redactionState: 'none',
      },
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      sideEffect: 'none',
      status: 'requested',
      requestedAt: '2026-05-16T00:00:00.000Z',
    };
    const decision: ToolPolicyDecision = {
      decision: 'allow',
      reason: 'Read-only workspace tool.',
      effectiveRiskLevel: 'low',
      requiredSandbox: { level: 'read_only_workspace', networkPolicy: 'deny' },
      evaluatedAt: '2026-05-16T00:00:01.000Z',
    };
    const approval: ApprovalRequest = {
      approvalRequestId: 'approval-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionKind: 'call_tool',
      toolName: 'workspace_read_file',
      capabilities: ['workspace_read'],
      riskLevel: 'low',
      title: 'Approve read',
      summary: 'Read src/index.ts',
      preview: { action: 'Read file', targets: [{ kind: 'file', label: 'src/index.ts' }] },
      requestedScope: 'once',
      status: 'pending',
      createdAt: '2026-05-16T00:00:02.000Z',
    };
    const observation: ToolObservation = {
      observationId: 'observation-1',
      toolCallId: 'tool-call-1',
      runId: 'run-1',
      stepId: 'step-1',
      status: 'succeeded',
      summary: 'Read file.',
      textPreview: 'export {}',
      createdAt: '2026-05-16T00:00:03.000Z',
    };

    repo.saveToolCall(toolCall);
    repo.savePolicyDecision('policy-1', 'run-1', 'tool-call-1', decision);
    repo.saveApprovalRequest(approval);
    repo.saveToolObservation(observation);

    expect(repo.getToolCall('tool-call-1')).toMatchObject({ toolName: 'workspace_read_file' });
    expect(repo.listToolCallsByRun('run-1')).toHaveLength(1);
    expect(repo.listPolicyDecisionsByToolCall('tool-call-1')[0].decision).toBe('allow');
    expect(repo.getApprovalRequest('approval-1')?.status).toBe('pending');
    expect(repo.listToolObservationsByToolCall('tool-call-1')[0].summary).toBe('Read file.');
  });
});

function seedLifecycle(database: Database.Database): void {
  database.prepare(`
    INSERT INTO sessions (session_id, title, status, created_at, updated_at)
    VALUES ('session-1', 'Tool session', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO runs (run_id, session_id, mode, goal, status, created_at)
    VALUES ('run-1', 'session-1', 'execute', 'Use tool', 'running', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO run_steps (step_id, run_id, kind, status)
    VALUES ('step-1', 'run-1', 'tool', 'running')
  `).run();
  database.prepare(`
    INSERT INTO run_actions (action_id, run_id, step_id, kind, status, requested_at)
    VALUES ('action-1', 'run-1', 'step-1', 'call_tool', 'requested', '2026-05-16T00:00:00.000Z')
  `).run();
}
