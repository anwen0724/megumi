/*
 * Owns the Product approval continuation entry over Engine resume semantics.
 * Host adapters only validate, translate, and forward approval requests here.
 */
import type {
  Engine,
  Run,
  RunApprovalDecision,
  RunFailure,
  RunStatus,
} from '@megumi/engine';
import type { RuntimeEvent } from '@megumi/events';

export type ProductApprovalDecision =
  | { decision: 'approved'; optionId: string; reason?: string }
  | { decision: 'denied'; reason?: string };

export interface ProductApprovalResolveRequest {
  approvalRequestId: string;
  decision: ProductApprovalDecision;
}

export interface ProductApprovalRun {
  runId: string;
  sessionId: string;
  status: RunStatus;
  createdAt: string;
  completedAt?: string;
}

export type ProductApprovalResult =
  | { status: 'resumed'; approvalRequestId: string; run: ProductApprovalRun }
  | { status: 'not_found'; approvalRequestId: string }
  | { status: 'not_waiting'; approvalRequestId: string; run: ProductApprovalRun }
  | { status: 'failed'; approvalRequestId: string; failure: RunFailure };

export interface ProductApprovalInvocation {
  payload: ProductApprovalResult;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface ProductApproval {
  resolve(request: ProductApprovalResolveRequest): Promise<ProductApprovalInvocation>;
}

export function createProductApproval(
  engine: Pick<Engine, 'resumeRun'>,
): ProductApproval {
  return {
    async resolve(request) {
      const result = await engine.resumeRun({
        runApprovalId: request.approvalRequestId,
        decision: toEngineApprovalDecision(request.decision),
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
            approvalRequestId: result.runApprovalId,
          },
        };
      }
      if (result.status === 'not_waiting' || result.status === 'already_resolved') {
        return {
          payload: {
            status: 'not_waiting',
            approvalRequestId: request.approvalRequestId,
            run: toProductApprovalRun(result.run),
          },
        };
      }
      return {
        payload: {
          status: 'resumed',
          approvalRequestId: request.approvalRequestId,
          run: toProductApprovalRun(result.run),
        },
        events: result.events,
      };
    },
  };
}

function toEngineApprovalDecision(
  decision: ProductApprovalDecision,
): RunApprovalDecision {
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

function toProductApprovalRun(run: Run): ProductApprovalRun {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}
