/*
 * Approval UI DTOs exposed by the host interface.
 */
import type { RuntimeEvent } from '../../coding-agent/events';
import type { AgentRunFailure } from '../../coding-agent/agent-run';

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
