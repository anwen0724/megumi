/*
 * Approval UI DTOs exposed by the host interface.
 */
import type { RuntimeEvent } from '../../events';

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

export interface ApprovalControllerResult {
  data: ApprovalResolveData;
  events?: AsyncIterable<RuntimeEvent>;
}
