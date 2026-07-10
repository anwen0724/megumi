import type { RuntimeEvent } from '../../coding-agent/events';

import type {
  AgentRunFailure,
  AgentRunService,
  ResumeRunAfterApprovalResult,
} from '../../coding-agent/agent-run';

/*
 * Implements ApprovalHost by mapping host decisions to Agent Run resume calls.
 */

export interface ApprovalHost {
  resolve(request: ApprovalResolvePayload): Promise<ApprovalHostResult>;
}

export function createApprovalHost(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await agentRunService.resumeRunAfterApproval({
        approval_request_id: request.approvalRequestId,
        decision: toApprovalDecision(request),
      });
      if (result.status !== 'resumed') {
        return {
          status: 'failed',
          approvalRequestId: request.approvalRequestId,
          failure: failureForResumeResult(result),
          ...('events' in result && result.events ? { events: result.events } : {}),
        };
      }

      return {
        status: 'resolved',
        data: {
          approval: {
            approvalRecordId: `approval-record:${crypto.randomUUID()}`,
            approvalRequestId: request.approvalRequestId,
            toolCallId: 'unknown',
            toolExecutionId: 'unknown',
            runId: 'unknown',
            stepId: 'unknown',
            decision: request.decision,
            scope: request.scope,
            decidedBy: 'user',
            ...(request.reason ? { reason: request.reason } : {}),
            decidedAt: request.decidedAt,
          },
        },
        events: result.events,
      };
    },
  };
}

function failureForResumeResult(
  result: Exclude<ResumeRunAfterApprovalResult, { status: 'resumed' }>,
): AgentRunFailure {
  if (result.status === 'failed') {
    return result.failure;
  }
  if (result.status === 'not_found') {
    return {
      code: 'approval_failed',
      message: `Approval request was not found: ${result.approval_request_id}`,
      retryable: false,
    };
  }
  return {
    code: 'runtime_interrupted',
    message: 'This Agent Run is no longer waiting for approval.',
    retryable: false,
  };
}

/*
 * Approval UI DTOs exposed by the host interface.
 */


export interface ApprovalResolvePayload {
  approvalRequestId: string;
  decision: 'approved' | 'denied';
  scope: 'once' | 'session';
  reason?: string;
  decidedAt: string;
}

export interface ApprovalResolveData {
  approval: {
    approvalRecordId: string;
    approvalRequestId: string;
    toolCallId: string;
    toolExecutionId: string;
    runId: string;
    stepId: string;
    decision: ApprovalResolvePayload['decision'];
    scope: ApprovalResolvePayload['scope'];
    decidedBy: 'user';
    reason?: string;
    decidedAt: string;
  };
}

export interface ApprovalHostResolvedResult {
  status: 'resolved';
  data: ApprovalResolveData;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ApprovalHostFailedResult {
  status: 'failed';
  approvalRequestId: string;
  failure: AgentRunFailure;
  events?: RuntimeEvent[];
}

export type ApprovalHostResult =
  | ApprovalHostResolvedResult
  | ApprovalHostFailedResult;

/*
 * Maps approval UI requests into Agent Run approval decisions.
 */

export function toApprovalDecision(payload: ApprovalResolvePayload) {
  return {
    approval_request_id: payload.approvalRequestId,
    decision: payload.decision,
    scope: payload.scope,
    decided_by: 'user' as const,
    decided_at: payload.decidedAt,
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
}
