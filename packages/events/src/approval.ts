/*
 * Approval layer: user decisions that gate tool execution.
 * A decision is its own fact (when, who, how) — independent of the tool
 * execution it gates, which is why it is a separate layer, not a tool status.
 * approval is the only "waiting" event: if it is lost, nothing later covers it.
 * The bus only delivers it best-effort; the UI discovers pending approvals by
 * querying the engine, which is the one waiting for them.
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const ApprovalRequestedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  /** Human-readable reason shown to the user. */
  reason: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  /** Engine-side approval identity, used to resolve the approval later. */
  approvalRequestId: z.string().min(1),
}).strict();

export const ApprovalResolvedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
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
