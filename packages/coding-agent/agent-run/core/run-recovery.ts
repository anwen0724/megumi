/*
 * Agent Run interrupted-run cleanup rules.
 * V1 does not resume interrupted runs after runtime restart.
 */
import type { AgentRun, AgentRunApprovalRequest } from '../contracts/agent-run-contracts';
import { transitionAgentRunStatus } from './run-lifecycle';

export type InterruptedRunCleanupRepository = {
  listInterruptedRuns(): AgentRun[];
  saveRun(run: AgentRun): AgentRun;
  listPendingApprovalRequestsByRun(runId: string): AgentRunApprovalRequest[];
  saveApprovalRequest(request: AgentRunApprovalRequest): AgentRunApprovalRequest;
};

export type CleanupInterruptedRunsCoreRequest = {
  repository: InterruptedRunCleanupRepository;
  cleaned_at: string;
};

export type CleanupInterruptedRunsCoreResult = {
  cleaned_run_ids: string[];
  cleaned_runs: Array<{
    run: AgentRun;
    previous_status: AgentRun['status'];
    cancelled_approvals: AgentRunApprovalRequest[];
  }>;
};

export function cleanupInterruptedRuns(
  request: CleanupInterruptedRunsCoreRequest,
): CleanupInterruptedRunsCoreResult {
  const cleanedRunIds: string[] = [];
  const cleanedRuns: CleanupInterruptedRunsCoreResult['cleaned_runs'] = [];

  for (const run of request.repository.listInterruptedRuns()) {
    if (run.status === 'running') {
      const failedRun = request.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'failed',
        changed_at: request.cleaned_at,
        failure: {
          code: 'runtime_interrupted',
          message: 'Runtime interrupted before the Agent Run reached a terminal state.',
          retryable: false,
        },
      }));
      cleanedRunIds.push(run.run_id);
      cleanedRuns.push({
        run: failedRun,
        previous_status: run.status,
        cancelled_approvals: [],
      });
      continue;
    }

    if (run.status === 'waiting_for_approval') {
      const cancelledApprovals = cancelPendingApprovals(request.repository, run.run_id, request.cleaned_at);
      const cancellingRun = transitionAgentRunStatus({
        run,
        to: 'cancelling',
        changed_at: request.cleaned_at,
      });
      request.repository.saveRun(cancellingRun);
      const cancelledRun = transitionAgentRunStatus({
        run: cancellingRun,
        to: 'cancelled',
        changed_at: request.cleaned_at,
      });
      request.repository.saveRun(cancelledRun);
      cleanedRunIds.push(run.run_id);
      cleanedRuns.push({
        run: cancelledRun,
        previous_status: run.status,
        cancelled_approvals: cancelledApprovals,
      });
      continue;
    }

    if (run.status === 'cancelling') {
      const cancelledRun = request.repository.saveRun(transitionAgentRunStatus({
        run,
        to: 'cancelled',
        changed_at: request.cleaned_at,
      }));
      cleanedRunIds.push(run.run_id);
      cleanedRuns.push({
        run: cancelledRun,
        previous_status: run.status,
        cancelled_approvals: [],
      });
    }
  }

  return { cleaned_run_ids: cleanedRunIds, cleaned_runs: cleanedRuns };
}

function cancelPendingApprovals(
  repository: InterruptedRunCleanupRepository,
  runId: string,
  decidedAt: string,
): AgentRunApprovalRequest[] {
  const cancelledApprovals: AgentRunApprovalRequest[] = [];
  for (const approval of repository.listPendingApprovalRequestsByRun(runId)) {
    const cancelled = repository.saveApprovalRequest({
      ...approval,
      status: 'cancelled',
      decided_at: decidedAt,
    });
    cancelledApprovals.push(cancelled);
  }
  return cancelledApprovals;
}
