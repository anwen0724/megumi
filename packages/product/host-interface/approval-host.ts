import type {
  Engine,
  Run,
  RunApprovalDecision,
  RunFailure,
  RunStatus,
} from '@megumi/engine';
import type { RuntimeEvent } from '../../agent/events';
import { z } from 'zod';

/*
 * Implements ApprovalHost by mapping stable host decisions to Engine resume calls.
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
const RunFailureSchema = z.object({
  code: z.enum([
    'session_failed', 'context_failed', 'model_call_failed', 'permission_failed',
    'tool_system_failed', 'loop_limit_exceeded', 'runtime_protocol_violation',
    'cancellation_failed', 'internal_error',
  ]),
  message: z.string(), retryable: z.boolean().optional(), details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();
const ApprovalRunUiDtoSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(['running', 'waiting', 'cancelling', 'completed', 'failed', 'cancelled']),
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
    status: z.literal('failed'), approvalRequestId: z.string().min(1), failure: RunFailureSchema,
  }).strict(),
]);

export function createApprovalHost(
  engine: Pick<Engine, 'resumeRun'>,
): ApprovalHost {
  return {
    async resolve(request) {
      const result = await engine.resumeRun({
        runApprovalId: request.approvalRequestId,
        decision: toApprovalDecision(request),
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
  status: RunStatus;
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
  failure: RunFailure;
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

/*
 * Maps approval UI requests into Engine approval decisions.
 */

export function toApprovalDecision(payload: ApprovalResolvePayload): RunApprovalDecision {
  return payload.decision === 'approved'
    ? {
        decision: 'approved',
        optionId: payload.optionId,
        ...(payload.reason ? { reason: payload.reason } : {}),
      }
    : {
        decision: 'denied',
        ...(payload.reason ? { reason: payload.reason } : {}),
      };
}

function toApprovalRunUiDto(run: Run): ApprovalRunUiDto {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    createdAt: run.createdAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}
