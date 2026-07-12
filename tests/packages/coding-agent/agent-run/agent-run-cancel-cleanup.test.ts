import { describe, expect, it } from 'vitest';
import {
  createAgentRunService,
  type AgentRun,
  type AgentRunApprovalRequest,
  type CreateAgentRunServiceOptions,
} from '@megumi/coding-agent/agent-run';
import {
  cleanupInterruptedRuns,
  type InterruptedRunCleanupRepository,
} from '@megumi/coding-agent/agent-run/core/run-recovery';
import { createInMemoryAgentRunRepository, createMessageFlowDependencies } from './agent-run-test-helpers';

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
    expect(result.cleaned_runs.map((entry) => ({
      run_id: entry.run.run_id,
      previous_status: entry.previous_status,
      status: entry.run.status,
      cancelled_approvals: entry.cancelled_approvals.map((approval) => approval.approval_request_id),
    }))).toEqual([
      {
        run_id: 'run-running',
        previous_status: 'running',
        status: 'failed',
        cancelled_approvals: [],
      },
      {
        run_id: 'run-waiting',
        previous_status: 'waiting_for_approval',
        status: 'cancelled',
        cancelled_approvals: ['approval-1'],
      },
      {
        run_id: 'run-cancelling',
        previous_status: 'cancelling',
        status: 'cancelled',
        cancelled_approvals: [],
      },
    ]);
    expect(repository.getRun('run-running')?.status).toBe('failed');
    expect(repository.getRun('run-running')?.failure?.code).toBe('runtime_interrupted');
    expect(repository.getRun('run-waiting')?.status).toBe('cancelled');
    expect(repository.getRun('run-cancelling')?.status).toBe('cancelled');
    expect(repository.getApprovalRequest('approval-1')?.status).toBe('cancelled');
  });

  it('cancelRun cancels pending approval requests for the run', async () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun(sampleRun({ status: 'waiting_for_approval' }));
    repository.createApprovalRequest(sampleApprovalRequest());
    const dependencies = createMessageFlowDependencies({ repository });
    const service = createAgentRunService(dependencies as unknown as CreateAgentRunServiceOptions);

    const result = await service.cancelRun({ run_id: 'run-1' });

    expect(result.status).toBe('cancelled');
    expect(repository.getRun('run-1')?.status).toBe('cancelled');
    expect(repository.getApprovalRequest('approval-1')?.status).toBe('cancelled');
    expect(dependencies.context_service.recordCompletedRunUsage).not.toHaveBeenCalled();
  });

  it('cleanupInterruptedRuns returns and persists replayable runtime events', async () => {
    const repository = createInMemoryAgentRunRepository();
    repository.createRun(sampleRun({ run_id: 'run-running', status: 'running' }));
    repository.createRun(sampleRun({ run_id: 'run-waiting', status: 'waiting_for_approval' }));
    repository.createApprovalRequest(sampleApprovalRequest({
      approval_request_id: 'approval-1',
      run_id: 'run-waiting',
      requested_scope: 'once',
    }));
    const service = createAgentRunService(createMessageFlowDependencies({ repository }) as unknown as CreateAgentRunServiceOptions);

    const result = await service.cleanupInterruptedRuns({ reason: 'runtime_started' });

    expect(result.status).toBe('completed');
    if (result.status !== 'completed') {
      throw new Error('Expected cleanup to complete.');
    }
    expect(result.cleaned_run_ids).toEqual(['run-running', 'run-waiting']);
    expect(result.events.map((event) => event.eventType)).toEqual([
      'run.failed',
      'approval.resolved',
      'run.cancelled',
    ]);
    expect(result.events[0]).toMatchObject({
      runId: 'run-running',
      payload: {
        error: {
          message: 'Runtime interrupted before the Agent Run reached a terminal state.',
          source: 'core',
        },
      },
    });
    expect(result.events[1]).toMatchObject({
      runId: 'run-waiting',
      payload: {
        approvalRequestId: 'approval-1',
        decision: 'cancelled',
        scope: 'once',
      },
    });
    expect(result.events[2]).toMatchObject({
      runId: 'run-waiting',
      payload: {
        reason: 'runtime_started_cleanup',
      },
    });
    expect(repository.listRuntimeEventsByRun('run-waiting').map((event) => event.eventType)).toEqual([
      'approval.resolved',
      'run.cancelled',
    ]);
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
