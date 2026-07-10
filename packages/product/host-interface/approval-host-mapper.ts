/*
 * Maps approval UI requests into Agent Run approval decisions.
 */
import type { ApprovalResolvePayload } from './approval-host-types';

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
