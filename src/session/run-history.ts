// Defines persisted run history facts; Agent Run execution belongs to src/agent.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type { SessionId, SessionRunId, SessionSourceEntryId } from './ids';

export const SessionRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type SessionRunStatus = z.infer<typeof SessionRunStatusSchema>;

export const SessionRunRecordSchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    sourceEntryId: z.string().min(1),
    inputSummary: z.string().min(1),
    status: SessionRunStatusSchema,
    startedAt: z.string().min(1),
    endedAt: z.string().min(1).optional(),
    error: JsonObjectSchema.optional(),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface SessionRunRecord {
  id: SessionRunId;
  sessionId: SessionId;
  sourceEntryId: SessionSourceEntryId;
  inputSummary: string;
  status: SessionRunStatus;
  startedAt: IsoDateTime;
  endedAt?: IsoDateTime;
  error?: JsonObject;
  metadata?: JsonObject;
}
