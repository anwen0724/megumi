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
  /** Trigger of the compaction, for diagnostics. */
  trigger: z.enum(['threshold', 'manual']),
}).strict();

export const CompactionEndedPayloadSchema = z.object({
  /** Reference to the stored compaction summary. */
  compactionId: z.string().min(1),
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
  'compaction.started': CompactionStartedPayloadSchema,
  'compaction.ended': CompactionEndedPayloadSchema,
  'branch_marker.created': BranchMarkerCreatedPayloadSchema,
  'branch_draft.cancelled': BranchDraftCancelledPayloadSchema,
} as const;

export type SessionEventPayloadByType = {
  [TType in keyof typeof SessionEventSchemas]: z.infer<(typeof SessionEventSchemas)[TType]>;
};

export type SessionEventType = keyof SessionEventPayloadByType;
