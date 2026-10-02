/* Implements Product approval submission using Agent Execution-owned state. */
import type { AgentRuntime, AgentRunSnapshot } from '@megumi/agent-runtime/agent-runtime';
import type { ApprovalDecisionRequest } from '@megumi/agent-runtime/agent-runtime';
import type { ApprovalHost, ApprovalResolvePayload, ApprovalRunUiDto } from './approval-contracts';

/** Creates the Product operations exposed through ApprovalHost. */
export function createApprovalOperations(
  executions: Pick<AgentRuntime, 'resolveApproval'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await executions.resolveApproval({
        approvalId: request.approvalRequestId,
        decision: toApprovalDecision(request),
      });
      if (result.status === 'failed') {
        return {
          payload: {
            status: 'failed',
            approvalRequestId: request.approvalRequestId,
            failure: result.error,
          },
        };
      }
      if (result.status === 'not_found') {
        return {
          payload: {
            status: 'not_found',
            approvalRequestId: result.approvalId,
          },
        };
      }
      if (result.status === 'not_waiting' || result.status === 'already_resolved') {
        return {
          payload: {
            status: 'not_waiting',
            approvalRequestId: request.approvalRequestId,
            run: toApprovalRunDto(result.run),
          },
        };
      }
      return {
        payload: {
          status: 'resumed',
          approvalRequestId: request.approvalRequestId,
          run: toApprovalRunDto(result.run),
        },
      };
    },
  };
}

function toApprovalDecision(decision: ApprovalResolvePayload): ApprovalDecisionRequest {
  return decision.decision === 'approved'
    ? {
        decision: 'approved',
        optionId: decision.optionId,
        ...(decision.reason ? { reason: decision.reason } : {}),
      }
    : {
        decision: 'denied',
        ...(decision.reason ? { reason: decision.reason } : {}),
      };
}

function toApprovalRunDto(execution: AgentRunSnapshot): ApprovalRunUiDto {
  if (execution.kind !== 'conversation' || !execution.sessionId) {
    throw new Error('Approval resolution returned a non-conversation execution.');
  }
  return {
    executionId: execution.runId,
    sessionId: execution.sessionId,
    status: execution.status,
    createdAt: execution.createdAt,
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
  };
}
