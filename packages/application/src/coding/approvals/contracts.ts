/*
 * Defines Coding approval requests, user decisions and their session event payloads.
 */
import { z } from 'zod';

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

const ExecutionFailureSchema = z.object({
  code: z.enum([
    'SESSION_FAILED', 'CONTEXT_FAILED', 'MODEL_CALL_FAILED', 'PERMISSION_FAILED',
    'TOOL_SYSTEM_FAILED', 'LOOP_LIMIT_EXCEEDED', 'RUNTIME_PROTOCOL_VIOLATION',
    'CANCELLATION_FAILED', 'INTERNAL_ERROR',
  ]),
  message: z.string(), retryable: z.boolean().optional(), details: z.record(z.string(), JsonValueSchema).optional(),
}).strict();

const ApprovalRunUiDtoSchema = z.object({
  executionId: z.string().min(1),
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
    status: z.literal('failed'), approvalRequestId: z.string().min(1), failure: ExecutionFailureSchema,
  }).strict(),
]);

export type ApprovalResolvePayload = z.infer<typeof ApprovalResolvePayloadSchema>;

export interface ApprovalRunUiDto {
  executionId: string;
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
  failure: z.infer<typeof ExecutionFailureSchema>;
}

export type ApprovalHostResult =
  | ApprovalHostResumedResult
  | ApprovalHostNotFoundResult
  | ApprovalHostNotWaitingResult
  | ApprovalHostFailedResult;

export interface ApprovalHostInvocation {
  payload: ApprovalHostResult;
}

export const ApprovalOptionSchema = z.object({
  optionId: z.string().min(1),
  /** How long the approved permission lasts. */
  scope: z.enum(['once', 'session']),
  label: z.string().min(1),
  description: z.string().optional(),
}).strict();

export const ApprovalToolIdentitySchema = z.object({
  sourceId: z.string().min(1),
  namespace: z.string().min(1),
  sourceToolName: z.string().min(1),
}).strict();

export const ApprovalRequestedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  /** Where the tool comes from. */
  toolIdentity: ApprovalToolIdentitySchema,
  /** Human-readable reason shown to the user. */
  reason: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  /** The operations being approved. */
  operations: z.array(z.record(z.string(), z.unknown())),
  /** Agent approval identity, used to resolve the approval later. */
  approvalRequestId: z.string().min(1),
  /** The permission scopes the user may grant; the UI renders them as choices. */
  options: z.array(ApprovalOptionSchema),
  /** The pre-selected option; matches one of options[].optionId. */
  defaultOptionId: z.string().min(1),
  /** Optional preview of the action and its targets, for the UI. */
  preview: z.object({
    action: z.string().min(1),
    targets: z.array(z.object({
      kind: z.string().min(1),
      label: z.string().min(1),
    }).strict()),
  }).strict().optional(),
}).strict();

export type ApprovalOption = z.infer<typeof ApprovalOptionSchema>;

export const ApprovalResolvedPayloadSchema = z.object({
  /** Agent approval identity, matching approval.requested. */
  approvalRequestId: z.string().min(1),
  toolCallId: z.string().min(1),
  /** How the approval was settled: expired covers a timed-out approval; cancelled
   *  covers a run cancelled while the approval was pending. */
  decision: z.enum(['approved', 'denied', 'expired', 'cancelled']),
  /** The option the user chose when approving — business meaning: a session
   *  option persists the grant so the tool is not re-approved this session. */
  optionId: z.string().min(1).optional(),
  /** When the decision was made. */
  decidedAt: z.string().datetime({ offset: true }),
}).strict();

export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayloadSchema>;

export type ApprovalResolvedPayload = z.infer<typeof ApprovalResolvedPayloadSchema>;

export const ApprovalEventSchemas = {
  'approval.requested': ApprovalRequestedPayloadSchema,
  'approval.resolved': ApprovalResolvedPayloadSchema,
} as const;

export type ApprovalEventPayloadByType = {
  [TType in keyof typeof ApprovalEventSchemas]: z.infer<(typeof ApprovalEventSchemas)[TType]>;
};

export type ApprovalEventType = keyof ApprovalEventPayloadByType;
