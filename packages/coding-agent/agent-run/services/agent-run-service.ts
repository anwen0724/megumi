/*
 * Agent Run Service public factory.
 * The orchestration implementation is filled in by the following refactor tasks.
 */
import type {
  AgentRunFailure,
  AgentRunService,
  CancelRunRequest,
  CancelRunResult,
  CleanupInterruptedRunsRequest,
  CleanupInterruptedRunsResult,
  ResumeRunAfterApprovalRequest,
  ResumeRunAfterApprovalResult,
  StartRunRequest,
  StartRunResult,
} from '../contracts/agent-run-contracts';

export type CreateAgentRunServiceOptions = Record<string, never>;

export function createAgentRunService(_options: CreateAgentRunServiceOptions = {}): AgentRunService {
  const failure = (message: string): AgentRunFailure => ({
    code: 'internal_error',
    message,
    retryable: false,
  });

  return {
    async startRun(request: StartRunRequest): Promise<StartRunResult> {
      return {
        status: 'failed',
        request_id: request.request_id,
        failure: failure('Agent Run Service is not implemented yet.'),
      };
    },
    cancelRun(request: CancelRunRequest): CancelRunResult {
      return { status: 'not_found', run_id: request.run_id };
    },
    resumeRunAfterApproval(request: ResumeRunAfterApprovalRequest): ResumeRunAfterApprovalResult {
      return { status: 'not_found', approval_request_id: request.approval_request_id };
    },
    cleanupInterruptedRuns(_request: CleanupInterruptedRunsRequest): CleanupInterruptedRunsResult {
      return { status: 'completed', cleaned_run_ids: [], events: [] };
    },
  };
}
