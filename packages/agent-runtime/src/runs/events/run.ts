/*
 * Run lifecycle layer: one user request, from acceptance to settlement.
 * run.started opens the run; run.ended closes it carrying the outcome.
 * The user message that triggered the run precedes run.started (see message.ts).
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const RunStartedPayloadSchema = z.object({
  /** Opaque user request identity as accepted by the run. */
  requestId: z.string().min(1),
  /** The model executing this run. */
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict();

export const RunEndedPayloadSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  error: z.object({
    message: z.string().min(1),
    code: z.string().optional(),
    /** Whether the failure can be retried; a consumer may offer a retry. */
    retryable: z.boolean().optional(),
    cause: z.object({
      owner: z.string().min(1),
      code: z.string().min(1),
    }).strict().optional(),
  }).strict().optional(),
  /** Reference to the settled assistant reply, when the run completed. */
  assistantMessageId: z.string().min(1).optional(),
}).strict();

/** A cancellation was requested for the run; the outcome is told by run.ended.
 *  The mechanism is the AbortSignal; the event records who asked, why, and
 *  what scope (the whole run). */
export const RunCancelRequestedPayloadSchema = z.object({
  requestedBy: z.enum(['user']),
  reason: z.enum(['user_cancelled']),
  scope: z.enum(['run']),
}).strict();

export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;
export type RunEndedPayload = z.infer<typeof RunEndedPayloadSchema>;
export type RunCancelRequestedPayload = z.infer<typeof RunCancelRequestedPayloadSchema>;

export const RunEventSchemas = {
  'run.started': RunStartedPayloadSchema,
  'run.cancel.requested': RunCancelRequestedPayloadSchema,
  'run.ended': RunEndedPayloadSchema,
} as const;

export type RunEventPayloadByType = {
  [TType in keyof typeof RunEventSchemas]: z.infer<(typeof RunEventSchemas)[TType]>;
};

export type RunEventType = keyof RunEventPayloadByType;
