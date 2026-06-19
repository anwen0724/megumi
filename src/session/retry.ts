// Defines retry and rerun history facts owned by the session module.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type { RetryAttemptId, SessionId, SessionSourceEntryId } from './ids';

export const RetryModeSchema = z.enum(['retry', 'rerun']);
export type RetryMode = z.infer<typeof RetryModeSchema>;

export const RetryAttemptSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    sourceEntryId: z.string().min(1),
    targetSourceEntryId: z.string().min(1),
    mode: RetryModeSchema,
    attemptNumber: z.number().int().positive(),
    createdAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface RetryAttempt {
  id: RetryAttemptId;
  sessionId: SessionId;
  sourceEntryId: SessionSourceEntryId;
  targetSourceEntryId: SessionSourceEntryId;
  mode: RetryMode;
  attemptNumber: number;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}
