/*
 * Message lifecycle layer: one message of the session transcript.
 * Roles are payload attributes, not event kinds: user, assistant, tool_result.
 * Only assistant messages stream, so message.update is assistant-only;
 * user and tool_result messages appear whole (started → ended).
 * message.update carries a full snapshot — consumers replace, never merge.
 * The user message precedes run.started and carries no executionId (input precedes run).
 *
 * The zod schemas are the single source of truth; the payload types are
 * derived from them so they can never drift apart.
 */

import { z } from 'zod';

export const MessageRoleSchema = z.enum(['user', 'assistant', 'tool_result']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageStartedPayloadSchema = z.object({
  role: MessageRoleSchema,
  /** Reference to the stored session message. */
  messageId: z.string().min(1),
}).strict();

/** Full latest snapshot of an assistant message while it streams. */
export const MessageUpdatePayloadSchema = z.object({
  role: z.literal('assistant'),
  messageId: z.string().min(1),
  /** Complete content as of now — replace the previous snapshot. */
  content: z.string(),
}).strict();

/** Full latest snapshot of the assistant's thinking while it streams. */
export const MessageThinkingUpdatePayloadSchema = z.object({
  messageId: z.string().min(1),
  /** Complete thinking as of now — replace the previous snapshot. */
  thinking: z.string(),
}).strict();

export const MessageEndedPayloadSchema = z.object({
  role: MessageRoleSchema,
  messageId: z.string().min(1),
  /** Settled content; for assistant messages this supersedes every update. */
  content: z.string(),
}).strict();

export type MessageStartedPayload = z.infer<typeof MessageStartedPayloadSchema>;
export type MessageUpdatePayload = z.infer<typeof MessageUpdatePayloadSchema>;
export type MessageEndedPayload = z.infer<typeof MessageEndedPayloadSchema>;

export const MessageEventSchemas = {
  'message.started': MessageStartedPayloadSchema,
  'message.update': MessageUpdatePayloadSchema,
  'message.thinking.update': MessageThinkingUpdatePayloadSchema,
  'message.ended': MessageEndedPayloadSchema,
} as const;

export type MessageEventPayloadByType = {
  [TType in keyof typeof MessageEventSchemas]: z.infer<(typeof MessageEventSchemas)[TType]>;
};

export type MessageEventType = keyof MessageEventPayloadByType;
