/*
 * Implements ApprovalHost by mapping host decisions to Agent Run resume calls.
 */
import type { AgentRunService } from '../../coding-agent/agent-run';
import type { AgentRunFailure, ResumeRunAfterApprovalResult } from '../../coding-agent/agent-run';
import { toApprovalDecision } from './approval-host-mapper';
import type {
  ApprovalHostResult,
  ApprovalResolvePayload,
} from './approval-host-types';

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
