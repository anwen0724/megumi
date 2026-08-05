/*
 * Session-scoped action layer: facts that happen in a session but outside any
 * run. Only execution actions live here (compaction, branch drafts) — state
 * changes like session rename are not events (see CONTEXT.md, domain boundary).
 * Long operations use a lifecycle pair; instant actions settle in one event.
 * Session-scoped events carry no runId; sequence locates them between runs.
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const CompactionStartedPayloadSchema = z.object({
  /** Trigger of the compaction, matching the context package's CompactionTrigger. */
  trigger: z.enum(['threshold', 'overflow', 'manual']),
  /** Identity shared with compaction.ended/.failed; the UI keys on it. */
  compactionId: z.string().min(1),
}).strict();

export const CompactionEndedPayloadSchema = z.object({
  /** How the compaction ended — the status is the outcome, like tool_execution.ended. */
  status: z.enum(['completed', 'failed']),
  /** Reference to the stored compaction summary. */
  compactionId: z.string().min(1),
  error: z.object({
    message: z.string().min(1),
    code: z.string().optional(),
  }).optional(),
}).strict();

export const BranchMarkerCreatedPayloadSchema = z.object({
  /** Reference to the stored branch marker. */
  markerId: z.string().min(1),
}).strict();

export const BranchDraftCancelledPayloadSchema = z.object({
  /** Reference to the draft session that was cancelled. */
  draftId: z.string().min(1),
}).strict();

export type CompactionStartedPayload = z.infer<typeof CompactionStartedPayloadSchema>;
export type CompactionEndedPayload = z.infer<typeof CompactionEndedPayloadSchema>;
export type BranchMarkerCreatedPayload = z.infer<typeof BranchMarkerCreatedPayloadSchema>;
export type BranchDraftCancelledPayload = z.infer<typeof BranchDraftCancelledPayloadSchema>;

export const SessionEventSchemas = {
  'session.compaction.started': CompactionStartedPayloadSchema,
  'session.compaction.ended': CompactionEndedPayloadSchema,
  'session.branch_marker.created': BranchMarkerCreatedPayloadSchema,
  'session.branch_draft.cancelled': BranchDraftCancelledPayloadSchema,
} as const;

export type SessionEventPayloadByType = {
  [TType in keyof typeof SessionEventSchemas]: z.infer<(typeof SessionEventSchemas)[TType]>;
};

export type SessionEventType = keyof SessionEventPayloadByType;
