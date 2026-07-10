import type { RuntimeEvent } from '../../coding-agent/events';

import type {
  AgentRunFailure,
  AgentRunService,
  ResumeRunAfterApprovalResult,
} from '../../coding-agent/agent-run';
import { z } from 'zod';

/*
 * Implements ApprovalHost by mapping host decisions to Agent Run resume calls.
 */

export interface ApprovalHost {
  resolve(request: ApprovalResolvePayload): Promise<ApprovalHostInvocation>;
}

export const ApprovalResolvePayloadSchema = z.object({
  approvalRequestId: z.string().min(1), decision: z.enum(['approved', 'denied']), scope: z.enum(['once', 'session']),
  reason: z.string().min(1).optional(), decidedAt: z.string().datetime(),
}).strict();
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
const AgentRunFailureSchema = z.object({
  code: z.enum([
    'input_failed', 'command_failed', 'session_failed', 'context_failed', 'model_call_failed', 'tool_call_failed',
    'approval_failed', 'cancel_failed', 'recovery_failed', 'loop_limit_exceeded', 'runtime_protocol_violation',
    'runtime_interrupted', 'internal_error',
  ]),
  message: z.string(), retryable: z.boolean().optional(), details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
const ApprovalResolveDataSchema = z.object({
  approval: z.object({
    approvalRecordId: z.string().min(1), approvalRequestId: z.string().min(1), toolCallId: z.string().min(1),
    toolExecutionId: z.string().min(1), runId: z.string().min(1), stepId: z.string().min(1),
    decision: z.enum(['approved', 'denied']), scope: z.enum(['once', 'session']), decidedBy: z.literal('user'),
    reason: z.string().optional(), decidedAt: z.string().datetime(),
  }).strict(),
}).strict();
export const ApprovalResolveResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('resolved'), data: ApprovalResolveDataSchema }).strict(),
  z.object({
    status: z.literal('failed'), approvalRequestId: z.string().min(1), failure: AgentRunFailureSchema,
  }).strict(),
]);

export function createApprovalHost(
  agentRunService: Pick<AgentRunService, 'resumeRunAfterApproval'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await agentRunService.resumeRunAfterApproval({
        approval_request_id: request.approvalRequestId,
        decision: toApprovalDecision(request),
      });
      if (result.status !== 'resumed') {
        return {
          payload: {
            status: 'failed',
            approvalRequestId: request.approvalRequestId,
            failure: failureForResumeResult(result),
          },
          ...('events' in result && result.events
            ? { events: toAsyncEvents(result.events) }
            : {}),
        };
      }

      return {
        payload: {
          status: 'resolved',
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
        },
        events: result.events,
      };
    },
  };
}

function failureForResumeResult(
  result: Exclude<ResumeRunAfterApprovalResult, { status: 'resumed' }>,
): AgentRunFailure {
  if (result.status === 'failed') {
    return result.failure;
  }
  if (result.status === 'not_found') {
    return {
      code: 'approval_failed',
      message: `Approval request was not found: ${result.approval_request_id}`,
      retryable: false,
    };
  }
  return {
    code: 'runtime_interrupted',
    message: 'This Agent Run is no longer waiting for approval.',
    retryable: false,
  };
}

/*
 * Approval UI DTOs exposed by the host interface.
 */


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
}

export interface ApprovalHostFailedResult {
  status: 'failed';
  approvalRequestId: string;
  failure: AgentRunFailure;
}

export type ApprovalHostResult =
  | ApprovalHostResolvedResult
  | ApprovalHostFailedResult;

export interface ApprovalHostInvocation {
  payload: ApprovalHostResult;
  events?: AsyncIterable<RuntimeEvent>;
}

async function* toAsyncEvents(events: RuntimeEvent[]): AsyncIterable<RuntimeEvent> {
  yield* events;
}

/*
 * Maps approval UI requests into Agent Run approval decisions.
 */

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
