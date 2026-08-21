/* Implements Product approval submission using Engine-owned Run state. */
import type { Run, Runs, RunApprovalDecision } from '@megumi/engine';
import type { ApprovalHost, ApprovalResolvePayload, ApprovalRunUiDto } from '../host/approval-host';

/** Creates the Product operations exposed through ApprovalHost. */
export function createApprovalOperations(
  runs: Pick<Runs, 'resolveApproval'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await runs.resolveApproval({
        approvalId: request.approvalRequestId,
        decision: toRunApprovalDecision(request),
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

function toRunApprovalDecision(decision: ApprovalResolvePayload): RunApprovalDecision {
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

function toApprovalRunDto(run: Run): ApprovalRunUiDto {
  return {
    executionId: run.executionId,
    sessionId: run.sessionId,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}
