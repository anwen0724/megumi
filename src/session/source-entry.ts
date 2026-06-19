// Defines the conversation source tree used for active path, branching, retry, rerun, and run history.
import { z } from 'zod';
import { JsonObjectSchema, type IsoDateTime, type JsonObject } from '../shared';
import type {
  BranchMarkerId,
  RetryAttemptId,
  SessionId,
  SessionMessageId,
  SessionRunId,
  SessionSourceEntryId,
} from './ids';

export const SessionSourceEntryKindSchema = z.enum(['message', 'branch', 'retry', 'rerun', 'run']);
export type SessionSourceEntryKind = z.infer<typeof SessionSourceEntryKindSchema>;

// Artifact and memory source entries are intentionally not added in this plan.
// Their source refs must be introduced by the artifact/memory owner specs so session does not invent their semantics.
export type SessionSourceRef =
  | { type: 'message'; messageId: SessionMessageId }
  | { type: 'branch'; branchMarkerId: BranchMarkerId }
  | { type: 'retry'; retryAttemptId: RetryAttemptId }
  | { type: 'rerun'; retryAttemptId: RetryAttemptId }
  | { type: 'run'; runId: SessionRunId };

export const SessionSourceRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), messageId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('branch'), branchMarkerId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('retry'), retryAttemptId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('rerun'), retryAttemptId: z.string().min(1) }).strict(),
  z.object({ type: z.literal('run'), runId: z.string().min(1) }).strict(),
]);

export const SessionSourceEntrySchema = z
  .object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    parentId: z.string().min(1).optional(),
    kind: SessionSourceEntryKindSchema,
    ref: SessionSourceRefSchema,
    createdAt: z.string().min(1),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

export interface SessionSourceEntry {
  id: SessionSourceEntryId;
  sessionId: SessionId;
  parentId?: SessionSourceEntryId;
  kind: SessionSourceEntryKind;
  ref: SessionSourceRef;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}
