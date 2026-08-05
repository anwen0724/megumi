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
  /** Engine-side approval identity, used to resolve the approval later. */
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
  /** Engine-side approval identity, matching approval.requested. */
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
