/*
 * Turn lifecycle layer: one model generation plus the tool batch it triggers.
 * Each model call is a turn; a tool result that leads to another generation
 * opens the next turn. turn.ended carries references only — message content
 * and tool results live in their own lifecycle layers (single-fact rule).
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const TurnStartedPayloadSchema = z.object({
  /** The message being generated (settled later by message.ended). */
  messageId: z.string().min(1),
}).strict();

export const TurnEndedPayloadSchema = z.object({
  stopReason: z.enum(['completed', 'tool_calls', 'error', 'cancelled']),
  /** Reference to the assistant message this turn produced. */
  messageId: z.string().min(1),
  /** References to the tool executions triggered by this turn. */
  toolCallIds: z.array(z.string().min(1)),
}).strict();

/** A failed model call attempt is being retried (attemptNumber is 1-based). */
export const TurnRetryStartedPayloadSchema = z.object({
  attemptNumber: z.number().int().positive(),
  retryKind: z.enum(['model_call']),
}).strict();

export const TurnRetryCompletedPayloadSchema = z.object({
  attemptNumber: z.number().int().positive(),
}).strict();

export const TurnRetryFailedPayloadSchema = z.object({
  attemptNumber: z.number().int().positive(),
  error: z.object({
    message: z.string().min(1),
    code: z.string().optional(),
  }).optional(),
}).strict();

export type TurnStartedPayload = z.infer<typeof TurnStartedPayloadSchema>;
export type TurnEndedPayload = z.infer<typeof TurnEndedPayloadSchema>;
export type TurnRetryStartedPayload = z.infer<typeof TurnRetryStartedPayloadSchema>;
export type TurnRetryCompletedPayload = z.infer<typeof TurnRetryCompletedPayloadSchema>;
export type TurnRetryFailedPayload = z.infer<typeof TurnRetryFailedPayloadSchema>;

export const TurnEventSchemas = {
  'turn.started': TurnStartedPayloadSchema,
  'turn.ended': TurnEndedPayloadSchema,
  'turn.retry.started': TurnRetryStartedPayloadSchema,
  'turn.retry.completed': TurnRetryCompletedPayloadSchema,
  'turn.retry.failed': TurnRetryFailedPayloadSchema,
} as const;

export type TurnEventPayloadByType = {
  [TType in keyof typeof TurnEventSchemas]: z.infer<(typeof TurnEventSchemas)[TType]>;
};

export type TurnEventType = keyof TurnEventPayloadByType;
