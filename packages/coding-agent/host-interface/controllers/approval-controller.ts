/*
 * Host approval controller. It maps UI approval decisions to Agent Run resume calls.
 */
import type { AgentRunService } from '../../agent-run';
import { toApprovalDecision } from '../mappers/approval-ui-mapper';
import type {
  ApprovalControllerResult,
  ApprovalResolvePayload,
} from '../contracts/approval-ui-contracts';

export interface ApprovalController {
  resolve(request: ApprovalResolvePayload): Promise<ApprovalControllerResult>;
}

export function createApprovalController(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
): ApprovalController {
  return {
    async resolve(request) {
      const events = resumeApproval(agentRunService, request);
      return {
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
        events,
      };
    },
  };
}

async function* resumeApproval(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
  payload: ApprovalResolvePayload,
) {
  const result = await agentRunService.resumeRunAfterApproval({
    approval_request_id: payload.approvalRequestId,
    decision: toApprovalDecision(payload),
  });
  if (result.status !== 'resumed') {
    return;
  }

  for await (const event of result.events) {
    yield event;
  }
}
