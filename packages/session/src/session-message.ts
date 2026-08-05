/* Defines the four durable Session message variants and their runtime schemas. */
import { z } from 'zod';
import type { SessionMessageAttachment } from './session-attachment';

/*
 * Content block shapes follow the AI package's provider-neutral content
 * shapes; Session owns the persisted zod schemas for them.
 */
export const SessionTextContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  textSignature: z.string().optional(),
}).strict();
export type SessionTextContent = z.infer<typeof SessionTextContentSchema>;

export const SessionImageContentSchema = z.object({
  type: z.literal('image'),
  data: z.string().min(1),
  mimeType: z.string().min(1),
}).strict();
export type SessionImageContent = z.infer<typeof SessionImageContentSchema>;

export const SessionUserContentSchema = z.discriminatedUnion('type', [
  SessionTextContentSchema,
  SessionImageContentSchema,
]);
export type SessionUserContent = z.infer<typeof SessionUserContentSchema>;
export const SessionUserContentListSchema = z.array(SessionUserContentSchema);

export const SessionThinkingContentSchema = z.object({
  type: z.literal('thinking'),
  thinking: z.string(),
  thinkingSignature: z.string().optional(),
  redacted: z.boolean().optional(),
}).strict();
export type SessionThinkingContent = z.infer<typeof SessionThinkingContentSchema>;

export const SessionToolCallSchema = z.object({
  type: z.literal('toolCall'),
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  thoughtSignature: z.string().optional(),
}).strict();
export type SessionToolCall = z.infer<typeof SessionToolCallSchema>;

export const SessionAssistantContentSchema = z.discriminatedUnion('type', [
  SessionTextContentSchema,
  SessionThinkingContentSchema,
  SessionToolCallSchema,
]);
export type SessionAssistantContent = z.infer<typeof SessionAssistantContentSchema>;
export const SessionAssistantContentListSchema = z.array(SessionAssistantContentSchema);

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
  display_content: SessionUserContentListSchema,
  model_content: SessionUserContentListSchema,
  skill_selection: z.object({
    name: z.string().min(1),
    skill_path: z.string().min(1),
  }).strict().optional(),
  legacy_provenance: LegacyMessageProvenanceSchema.optional(),
}).strict();

const AiUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  cacheWrite1h: z.number().int().nonnegative().optional(),
  reasoning: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.object({
    input: z.number().nonnegative(),
    output: z.number().nonnegative(),
    cacheRead: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative(),
    total: z.number().nonnegative(),
  }).strict(),
}).strict();

export const SessionModelResponsePayloadSchema = z.object({
  content: z.array(SessionAssistantContentSchema),
  outcome_status: z.enum(['completed', 'incomplete', 'failed']),
  reason_code: z.string().min(1).optional(),
  stop_reason: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  response_model: z.string().min(1).optional(),
  response_id: z.string().min(1).optional(),
  usage: AiUsageSchema.optional(),
  failure: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    retryAfterMs: z.number().nonnegative().optional(),
  }).strict().optional(),
  error_message: z.string().min(1).optional(),
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
  content: SessionUserContentListSchema,
  /** Tool-owned usage that never counts toward the main model Context. */
  usage: AiUsageSchema.optional(),
  legacy_provenance: LegacyMessageProvenanceSchema.optional(),
}).strict();

export const SessionAssistantReplyPayloadSchema = z.object({
  status: z.enum(ASSISTANT_REPLY_STATUSES),
  content: z.array(SessionAssistantContentSchema),
  reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
  api: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  response_model: z.string().min(1).optional(),
  response_id: z.string().min(1).optional(),
  usage: AiUsageSchema.optional(),
  error_message: z.string().min(1).optional(),
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
  content: z.array(SessionAssistantContentSchema),
  reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
  api: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  response_model: z.string().min(1).optional(),
  response_id: z.string().min(1).optional(),
  usage: AiUsageSchema.optional(),
  error_message: z.string().min(1).optional(),
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
  // Zod cannot place a refined object in a discriminated union. Repository
  // and History boundaries apply the complete Assistant Reply validation.
  SessionMessageBaseSchema.extend({
    message_kind: z.literal('assistant_reply'),
    status: z.enum(ASSISTANT_REPLY_STATUSES),
    content: z.array(SessionAssistantContentSchema),
    reason_code: z.enum(ASSISTANT_REPLY_REASON_CODES).optional(),
    api: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    response_model: z.string().min(1).optional(),
    response_id: z.string().min(1).optional(),
    usage: AiUsageSchema.optional(),
    error_message: z.string().min(1).optional(),
  }).strict(),
]);

/** The persisted user message, named without a Session prefix per the Context Spec. */
export type UserMessage = z.infer<typeof SessionUserMessageSchema>;
export type SessionModelResponseMessage = z.infer<typeof SessionModelResponseMessageSchema>;
export type SessionToolResultMessage = z.infer<typeof SessionToolResultMessageSchema>;
export type SessionAssistantReplyMessage = z.infer<typeof SessionAssistantReplyMessageSchema>;
export type SessionMessage =
  | UserMessage
  | SessionModelResponseMessage
  | SessionToolResultMessage
  | SessionAssistantReplyMessage;

export interface SessionMessageWithAttachments {
  message: SessionMessage;
  attachments: SessionMessageAttachment[];
  /** Zero-based position of this message Entry on the current active path. */
  active_path_order?: number;
}

export type SessionMessageContent = SessionUserContent[] | SessionAssistantContent[];

export function sessionMessageText(message: SessionMessage): string {
  const blocks = message.message_kind === 'user_message' ? message.display_content : message.content;
  return blocks.flatMap((block) => block.type === 'text' ? [block.text] : []).join('');
}

export function hasUserVisibleAssistantContent(content: SessionAssistantContent[]): boolean {
  return content.some((block) => block.type === 'text' && block.text.trim().length > 0);
}

export function isLegacySessionMessage(message: SessionMessage): boolean {
  return 'legacy_provenance' in message && message.legacy_provenance?.source === 'pre_final_reply_semantics';
}
