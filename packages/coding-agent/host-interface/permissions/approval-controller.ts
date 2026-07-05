/*
 * Host-facing approval adapter for UI shells.
 * It maps approval IPC DTOs to Agent Run Service approval resume calls.
 */
import type { ApprovalResolveData, ApprovalResolvePayload } from '@megumi/shared/ipc';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { AgentRunService } from '../../agent-run';
import { mapAgentRunEvents } from '../input-controller';

export interface ApprovalController {
  resolve(payload: ApprovalResolvePayload): { data: ApprovalResolveData; events?: AsyncIterable<RuntimeEvent> };
}

export function createApprovalController(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
): ApprovalController {
  return {
    resolve(payload) {
      const events = resumeApproval(agentRunService, payload);
      return {
        data: {
          approval: {
            approvalRecordId: `approval-record:${crypto.randomUUID()}`,
            approvalRequestId: payload.approvalRequestId,
            toolCallId: 'unknown',
            toolExecutionId: 'unknown',
            runId: 'unknown',
            stepId: 'unknown',
            decision: payload.decision,
            scope: payload.scope,
            decidedBy: 'user',
            ...(payload.reason ? { reason: payload.reason } : {}),
            decidedAt: payload.decidedAt,
          },
        },
        events,
      };
    },
  };
}

async function* resumeApproval(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
  payload: ApprovalResolvePayload,
): AsyncIterable<RuntimeEvent> {
  const result = await agentRunService.resumeRunAfterApproval({
    approval_request_id: payload.approvalRequestId,
    decision: {
      approval_request_id: payload.approvalRequestId,
      decision: payload.decision,
      scope: payload.scope,
      decided_by: 'user',
      decided_at: payload.decidedAt,
      ...(payload.reason ? { reason: payload.reason } : {}),
    },
  });
  if (result.status !== 'resumed') {
    return;
  }

  for await (const event of mapAgentRunEvents(result.events, payload.approvalRequestId)) {
    yield event;
  }
}
