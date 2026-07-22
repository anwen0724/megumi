/* Defines the canonical Session message variants and their persisted payloads. */
import { z } from 'zod';
import {
  AssistantContentBlockSchema,
  ContentBlockListSchema,
  type AssistantContentBlock,
  type ContentBlock,
} from '../../../model-content';
import type { SessionMessageAttachment } from './session-attachment';

export const SESSION_MESSAGE_KINDS = [
  'user_message',
  'model_response',
  'tool_result',
  'assistant_reply',
] as const;

export type SessionMessageKind = (typeof SESSION_MESSAGE_KINDS)[number];

export const ASSISTANT_REPLY_STATUSES = ['completed', 'failed', 'cancelled'] as const;
export type AssistantReplyStatus = (typeof ASSISTANT_REPLY_STATUSES)[number];

export const ASSISTANT_REPLY_REASON_CODES = [
  'normal_completion',
  'user_cancelled',
  'session_failed',
  'context_failed',
  'model_call_failed',
  'unsupported_content',
  'tool_call_failed',
  'approval_failed',
  'loop_limit_exceeded',
  'runtime_protocol_violation',
  'internal_error',
] as const;

export type AssistantReplyReasonCode = (typeof ASSISTANT_REPLY_REASON_CODES)[number];

export const LegacyMessageProvenanceSchema = z.object({
  source: z.literal('pre_final_reply_semantics'),
}).strict();

export type LegacyMessageProvenance = z.infer<typeof LegacyMessageProvenanceSchema>;

export const SessionUserMessagePayloadSchema = z.object({
  content: ContentBlockListSchema,
  legacy_provenance: LegacyMessageProvenanceSchema.optional(),
}).strict();

export const SessionModelResponsePayloadSchema = z.object({
  content: z.array(AssistantContentBlockSchema),
  outcome_status: z.enum(['completed', 'incomplete', 'failed']),
  reason_code: z.string().min(1).optional(),
  stop_reason: z.string().min(1).optional(),
  legacy_provenance: LegacyMessageProvenanceSchema.optional(),
}).strict();

export const SessionToolResultPayloadSchema = z.object({
  tool_call_id: z.string().min(1),
  tool_name: z.string().min(1),
  status: z.enum(['success', 'failure', 'permission_denied', 'user_rejected', 'cancelled']),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  content: ContentBlockListSchema,
  legacy_provenance: LegacyMessageProvenanceSchema.optional(),
}).strict();

export const SessionAssistantReplyPayloadSchema = z.object({
  status: z.enum(ASSISTANT_REPLY_STATUSES),
  content: z.array(AssistantContentBlockSchema),
  reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
}).strict().superRefine((payload, context) => {
  if (payload.content.some((block) => block.type === 'toolCall')) {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'Assistant Reply content cannot contain Work Tool Calls.',
    });
  }
  if (payload.status === 'completed' && !hasUserVisibleAssistantContent(payload.content)) {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'Completed Assistant Reply requires user-visible content.',
    });
  }
});

const SessionMessageBaseSchema = z.object({
  message_id: z.string().min(1),
  session_id: z.string().min(1),
  run_id: z.string().min(1).optional(),
  created_at: z.string().min(1),
  completed_at: z.string().min(1).optional(),
});

export const SessionUserMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('user_message'),
  ...SessionUserMessagePayloadSchema.shape,
}).strict();

export const SessionModelResponseMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('model_response'),
  ...SessionModelResponsePayloadSchema.shape,
}).strict();

export const SessionToolResultMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('tool_result'),
  ...SessionToolResultPayloadSchema.shape,
}).strict();

export const SessionAssistantReplyMessageSchema = SessionMessageBaseSchema.extend({
  message_kind: z.literal('assistant_reply'),
  status: z.enum(ASSISTANT_REPLY_STATUSES),
  content: z.array(AssistantContentBlockSchema),
  reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
}).strict().superRefine((message, context) => {
  const result = SessionAssistantReplyPayloadSchema.safeParse({
    status: message.status,
    content: message.content,
    ...(message.reason_code ? { reason_code: message.reason_code } : {}),
  });
  if (!result.success) {
    for (const issue of result.error.issues) context.addIssue(issue);
  }
  if (!message.run_id) {
    context.addIssue({ code: 'custom', path: ['run_id'], message: 'Assistant Reply requires run_id.' });
  }
  if (!message.completed_at) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'Assistant Reply requires completed_at.' });
  }
});

export const SessionMessageSchema = z.discriminatedUnion('message_kind', [
  SessionUserMessageSchema,
  SessionModelResponseMessageSchema,
  SessionToolResultMessageSchema,
  // Zod cannot place a refined object in a discriminated union. The base
  // object is used here; repository/service boundaries validate the payload.
  SessionMessageBaseSchema.extend({
    message_kind: z.literal('assistant_reply'),
    status: z.enum(ASSISTANT_REPLY_STATUSES),
    content: z.array(AssistantContentBlockSchema),
    reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
  }).strict(),
]);

export type SessionUserMessage = z.infer<typeof SessionUserMessageSchema>;
export type SessionModelResponseMessage = z.infer<typeof SessionModelResponseMessageSchema>;
export type SessionToolResultMessage = z.infer<typeof SessionToolResultMessageSchema>;
export type SessionAssistantReplyMessage = z.infer<typeof SessionAssistantReplyMessageSchema>;
export type SessionMessage =
  | SessionUserMessage
  | SessionModelResponseMessage
  | SessionToolResultMessage
  | SessionAssistantReplyMessage;

export function sessionMessageText(message: SessionMessage): string {
  return message.content.flatMap((block) => block.type === 'text' ? [block.text] : []).join('');
}

export function hasUserVisibleAssistantContent(content: AssistantContentBlock[]): boolean {
  return content.some((block) => block.type === 'text' && block.text.trim().length > 0);
}

export function isLegacySessionMessage(message: SessionMessage): boolean {
  return 'legacy_provenance' in message && message.legacy_provenance?.source === 'pre_final_reply_semantics';
}

export type SessionMessageWithAttachments = {
  message: SessionMessage;
  attachments: SessionMessageAttachment[];
  /** Zero-based position of this message Entry on the current active path. */
  active_path_order?: number;
};

export type SessionMessageContent = ContentBlock[] | AssistantContentBlock[];
