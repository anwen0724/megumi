/* Connects Agent approval waits to product events and user decisions. */
import type { ApprovalDecision, ApprovalRequest } from '@megumi/agent';
import type { JsonObject } from '@megumi/ai';
import type { EventBus } from './application';
import type { ApprovalHost, ApprovalResolvedPayload } from './approval-contracts';
import type { Session } from './coding/sessions/session-catalog';
import type { CodingRunSnapshot } from './coding/submit-message';

export interface ApprovalOperations extends ApprovalHost {
  awaitApproval(request: ApprovalRequest, session: Session): Promise<ApprovalDecision>;
}

interface PendingApproval {
  readonly request: ApprovalRequest;
  readonly sessionId: string;
  settle?: (decision: ApprovalDecision) => void;
  settledAt?: number;
}

/** Owns interaction promises only; permission rules and tool execution remain in Agent. */
export function createApprovalOperations(input: {
  readonly events: EventBus;
  readonly getRun: (runId: string) => CodingRunSnapshot | undefined;
  readonly terminalRetentionMs: number;
}): ApprovalOperations {
  const approvals = new Map<string, PendingApproval>();

  function prune(): void {
    for (const [id, item] of approvals) {
      if (item.settledAt && Date.now() - item.settledAt >= input.terminalRetentionMs) approvals.delete(id);
    }
  }

  return {
    awaitApproval(request, session) {
      if (request.signal.aborted) return Promise.resolve({ status: 'cancelled' });
      prune();
      const item: PendingApproval = { request, sessionId: session.session_id };
      approvals.set(request.approvalId, item);
      return new Promise(resolve => {
        const abort = () => item.settle?.({ status: 'cancelled' });
        item.settle = decision => {
          item.settle = undefined;
          item.settledAt = Date.now();
          request.signal.removeEventListener('abort', abort);
          const resolved: ApprovalResolvedPayload = {
            approvalRequestId: request.approvalId,
            toolCallId: request.toolCallId,
            decision: decision.status === 'allowed' ? 'approved' : decision.status,
            decidedAt: new Date().toISOString(),
            ...(decision.status === 'allowed' ? { optionId: decision.optionId } : {}),
          };
          input.events.publish({
            type: 'approval.resolved', sessionId: item.sessionId,
            executionId: request.runId, payload: resolved
          });
          resolve(decision);
        };
        request.signal.addEventListener('abort', abort, { once: true });
        const { registeredToolName, ...toolIdentity } = request.subject.toolIdentity;
        const args = request.subject.criticalInput;
        input.events.publish({
          type: 'approval.requested', sessionId: item.sessionId,
          executionId: request.runId, payload: {
            approvalRequestId: request.approvalId, toolCallId: request.toolCallId,
            toolName: registeredToolName, toolIdentity, reason: request.decision.reason,
            args: args !== null && typeof args === 'object' && !Array.isArray(args) ? args as JsonObject : { value: args },
            operations: request.operations.map(operation => ({ ...operation })),
            options: request.decision.options.map(option => ({
              optionId: option.optionId, scope: option.scope, ...option.display,
            })),
            defaultOptionId: request.decision.defaultOptionId,
          }
        });
      });
    },
    async resolve(request) {
      prune();
      const item = approvals.get(request.approvalRequestId);
      const run = item && input.getRun(item.request.runId);
      if (!item || !run) return { payload: { status: 'not_found', approvalRequestId: request.approvalRequestId } };
      const projection = {
        executionId: run.runId, sessionId: run.sessionId,
        status: run.status, createdAt: run.createdAt, completedAt: run.completedAt
      };
      if (!item.settle || item.request.signal.aborted) {
        return { payload: { status: 'not_waiting', approvalRequestId: request.approvalRequestId, run: projection } };
      }
      if (request.decision === 'approved' && !item.request.decision.options.some(option => option.optionId === request.optionId)) {
        return {
          payload: {
            status: 'failed', approvalRequestId: request.approvalRequestId,
            failure: { code: 'PERMISSION_FAILED', message: 'The selected approval option is unavailable.', retryable: false }
          }
        };
      }
      item.settle(request.decision === 'approved'
        ? { status: 'allowed', optionId: request.optionId } : { status: 'denied' });
      return { payload: { status: 'resumed', approvalRequestId: request.approvalRequestId, run: projection } };
    },
  };
}
