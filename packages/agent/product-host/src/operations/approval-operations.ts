/* Implements Product approval submission using Discovery Agent-owned execution state. */
import type { DiscoveryAgent, ExecutionSnapshot } from '@megumi/discovery';
import type { ApprovalHost, ApprovalResolvePayload, ApprovalRunUiDto } from '../host/approval-host';

/** Creates the Product operations exposed through ApprovalHost. */
export function createApprovalOperations(
  discoveryAgent: Pick<DiscoveryAgent, 'resolveApproval'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await discoveryAgent.resolveApproval({
        approvalId: request.approvalRequestId,
        decision: toApprovalDecision(request),
      });
      if (result.status === 'failed') {
        return {
          payload: {
            status: 'failed',
            approvalRequestId: request.approvalRequestId,
            failure: result.failure,
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
            run: toApprovalRunDto(result.execution),
          },
        };
      }
      return {
        payload: {
          status: 'resumed',
          approvalRequestId: request.approvalRequestId,
          run: toApprovalRunDto(result.execution),
        },
      };
    },
  };
}

function toApprovalDecision(decision: ApprovalResolvePayload): import('@megumi/discovery').ApprovalDecisionRequest {
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

function toApprovalRunDto(execution: ExecutionSnapshot): ApprovalRunUiDto {
  return {
    executionId: execution.executionId,
    sessionId: execution.sessionId,
    status: execution.status,
    createdAt: execution.createdAt,
    ...(execution.completedAt ? { completedAt: execution.completedAt } : {}),
  };
}
