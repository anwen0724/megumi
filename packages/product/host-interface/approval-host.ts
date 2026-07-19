import type { RuntimeEvent } from '../../agent/events';

import type {
  AgentRun,
  AgentRunFailure,
  AgentRunService,
  ApprovalDecisionIntent,
} from '../../agent/agent-run';
import { z } from 'zod';

/*
 * Implements ApprovalHost by mapping host decisions to Agent Run resume calls.
 */

export interface ApprovalHost {
  resolve(request: ApprovalResolvePayload): Promise<ApprovalHostInvocation>;
}

const ApprovalResolveBaseSchema = z.object({
  approvalRequestId: z.string().min(1), reason: z.string().min(1).optional(),
});
export const ApprovalResolvePayloadSchema = z.discriminatedUnion('decision', [
  ApprovalResolveBaseSchema.extend({ decision: z.literal('approved'), optionId: z.string().min(1) }).strict(),
  ApprovalResolveBaseSchema.extend({ decision: z.literal('denied') }).strict(),
]);
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
const AgentRunFailureSchema = z.object({
  code: z.enum([
    'input_failed', 'command_failed', 'session_failed', 'context_failed', 'model_call_failed', 'tool_call_failed',
    'approval_failed', 'cancel_failed', 'loop_limit_exceeded', 'runtime_protocol_violation',
    'runtime_interrupted', 'internal_error',
  ]),
  message: z.string(), retryable: z.boolean().optional(), details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
const ApprovalRunUiDtoSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.string().min(1),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
}).strict();
export const ApprovalResolveResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resumed'), approvalRequestId: z.string().min(1), run: ApprovalRunUiDtoSchema,
  }).strict(),
  z.object({ status: z.literal('not_found'), approvalRequestId: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('not_waiting'), approvalRequestId: z.string().min(1), run: ApprovalRunUiDtoSchema,
  }).strict(),
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
      if (result.status === 'failed') {
        return {
          payload: {
            status: 'failed',
            approvalRequestId: request.approvalRequestId,
            failure: result.failure,
          },
          ...(result.events ? { events: toAsyncEvents(result.events) } : {}),
        };
      }
      if (result.status === 'not_found') {
        return {
          payload: {
            status: 'not_found',
            approvalRequestId: result.approval_request_id,
          },
        };
      }
      if (result.status === 'not_waiting') {
        return {
          payload: {
            status: 'not_waiting',
            approvalRequestId: request.approvalRequestId,
            run: toApprovalRunUiDto(result.run),
          },
        };
      }
      return {
        payload: {
          status: 'resumed',
          approvalRequestId: request.approvalRequestId,
          run: toApprovalRunUiDto(result.run),
        },
        events: result.events,
      };
    },
  };
}

/*
 * Approval UI DTOs exposed by the host interface.
 */


export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;

export interface ApprovalRunUiDto {
  runId: string;
  sessionId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
}

export interface ApprovalHostResumedResult {
  status: 'resumed';
  approvalRequestId: string;
  run: ApprovalRunUiDto;
}

export interface ApprovalHostNotFoundResult {
  status: 'not_found';
  approvalRequestId: string;
}

export interface ApprovalHostNotWaitingResult {
  status: 'not_waiting';
  approvalRequestId: string;
  run: ApprovalRunUiDto;
}

export interface ApprovalHostFailedResult {
  status: 'failed';
  approvalRequestId: string;
  failure: AgentRunFailure;
}

export type ApprovalHostResult =
  | ApprovalHostResumedResult
  | ApprovalHostNotFoundResult
  | ApprovalHostNotWaitingResult
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

export function toApprovalDecision(payload: ApprovalResolvePayload): ApprovalDecisionIntent {
  const common = {
    approval_request_id: payload.approvalRequestId,
    decided_by: 'user' as const,
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
  return payload.decision === 'approved'
    ? { ...common, decision: 'approved', option_id: payload.optionId }
    : { ...common, decision: 'denied' };
}

function toApprovalRunUiDto(run: AgentRun): ApprovalRunUiDto {
  return {
    runId: run.run_id,
    sessionId: run.session_id,
    status: run.status,
    createdAt: run.created_at,
    ...(run.completed_at ? { completedAt: run.completed_at } : {}),
  };
}
