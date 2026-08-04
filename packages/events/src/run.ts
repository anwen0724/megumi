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
}).strict();

export const RunEndedPayloadSchema = z.object({
  status: z.enum(['completed', 'failed', 'cancelled']),
  error: z.object({
    message: z.string().min(1),
    code: z.string().optional(),
  }).optional(),
}).strict();

export type RunStartedPayload = z.infer<typeof RunStartedPayloadSchema>;
export type RunEndedPayload = z.infer<typeof RunEndedPayloadSchema>;

export const RunEventSchemas = {
  'run.started': RunStartedPayloadSchema,
  'run.ended': RunEndedPayloadSchema,
} as const;

export type RunEventPayloadByType = {
  [TType in keyof typeof RunEventSchemas]: z.infer<(typeof RunEventSchemas)[TType]>;
};

export type RunEventType = keyof RunEventPayloadByType;
