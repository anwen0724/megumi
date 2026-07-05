import { describe, expect, it } from 'vitest';
import type { AgentRun, AgentRunApprovalRequest } from '@megumi/coding-agent/agent-run';
import {
  cleanupInterruptedRuns,
  type InterruptedRunCleanupRepository,
} from '@megumi/coding-agent/agent-run/core/run-recovery';

describe('agent-run interrupted cleanup', () => {
  it('cleans interrupted runs without calling model, tools, or assistant persistence', () => {
    const repository = memoryRepository([
      sampleRun({ run_id: 'run-running', status: 'running' }),
      sampleRun({ run_id: 'run-waiting', status: 'waiting_for_approval' }),
      sampleRun({ run_id: 'run-cancelling', status: 'cancelling' }),
    ], [
      sampleApprovalRequest({ approval_request_id: 'approval-1', run_id: 'run-waiting' }),
    ]);

    const result = cleanupInterruptedRuns({
      repository,
      cleaned_at: '2026-01-01T00:10:00.000Z',
    });

    expect(result.cleaned_run_ids).toEqual(['run-running', 'run-waiting', 'run-cancelling']);
    expect(repository.getRun('run-running')?.status).toBe('failed');
    expect(repository.getRun('run-running')?.failure?.code).toBe('runtime_interrupted');
    expect(repository.getRun('run-waiting')?.status).toBe('cancelled');
    expect(repository.getRun('run-cancelling')?.status).toBe('cancelled');
    expect(repository.getApprovalRequest('approval-1')?.status).toBe('cancelled');
  });
});

function memoryRepository(
  runs: AgentRun[],
  approvals: AgentRunApprovalRequest[],
): InterruptedRunCleanupRepository & {
  getRun(runId: string): AgentRun | undefined;
  getApprovalRequest(approvalRequestId: string): AgentRunApprovalRequest | undefined;
} {
  const runById = new Map(runs.map((run) => [run.run_id, run]));
  const approvalById = new Map(approvals.map((approval) => [approval.approval_request_id, approval]));

  return {
    getRun: (runId) => runById.get(runId),
    getApprovalRequest: (approvalRequestId) => approvalById.get(approvalRequestId),
    listInterruptedRuns: () => [...runById.values()].filter((run) => (
      run.status === 'running'
      || run.status === 'waiting_for_approval'
      || run.status === 'cancelling'
    )),
    saveRun: (run) => {
      runById.set(run.run_id, run);
      return run;
    },
    listPendingApprovalRequestsByRun: (runId) => [...approvalById.values()]
      .filter((approval) => approval.run_id === runId && approval.status === 'pending'),
    saveApprovalRequest: (approval) => {
      approvalById.set(approval.approval_request_id, approval);
      return approval;
    },
  };
}

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: 'run-1',
    workspace_id: 'workspace-1',
    session_id: 'session-1',
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    trigger: { type: 'user_input', user_message_id: 'message-1' },
    status: 'running',
    created_at: '2026-01-01T00:00:00.000Z',
    started_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function sampleApprovalRequest(
  overrides: Partial<AgentRunApprovalRequest> = {},
): AgentRunApprovalRequest {
  return {
    approval_request_id: 'approval-1',
    run_id: 'run-1',
    subject: {
      type: 'tool_call',
      tool_call_id: 'tool-call-1',
      tool_name: 'run_command',
      input: { command: 'npm test' },
    },
    status: 'pending',
    created_at: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}
