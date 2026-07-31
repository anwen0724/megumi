import type { RuntimeEvent } from '@megumi/events';
import { z } from 'zod';
import type { ProductApproval } from '../approval';

/*
 * Adapts the stable Approval Host protocol to the Product approval entry.
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
  approval: Pick<ProductApproval, 'resolve'>,
): ApprovalHost {
  return {
    resolve: (request) => approval.resolve({
      approvalRequestId: request.approvalRequestId,
      decision: request.decision === 'approved'
        ? {
            decision: 'approved',
            optionId: request.optionId,
            ...(request.reason ? { reason: request.reason } : {}),
          }
        : {
            decision: 'denied',
            ...(request.reason ? { reason: request.reason } : {}),
          },
    }),
  };
}

/*
 * Approval UI DTOs exposed by the host interface.
 */


export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;

export interface ApprovalRunUiDto {
  runId: string;
  sessionId: string;
  status: z.infer<typeof ApprovalRunUiDtoSchema>['status'];
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
  failure: z.infer<typeof RunFailureSchema>;
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
