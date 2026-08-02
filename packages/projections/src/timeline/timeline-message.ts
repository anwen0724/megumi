/* Defines the stable Timeline read model and its co-located runtime schemas. */
import { z } from 'zod';
import {
  WorkspaceChangeFooterFactSchema,
  type WorkspaceChangeFooterFact,
} from '../workspace-change-footer';

type MessageId = string;
type RunId = string;
type SessionId = string;
type ToolCallId = string;
type ToolExecutionId = string;

export const TIMELINE_MESSAGE_ROLES = ['user', 'assistant', 'separator', 'activity'] as const;
export type TimelineMessageRole = (typeof TIMELINE_MESSAGE_ROLES)[number];

export const TEXT_FORMATS = ['plain', 'markdown'] as const;
export type TextFormat = (typeof TEXT_FORMATS)[number];

export const USER_ATTACHMENT_SOURCES = [
  'local_file',
  'clipboard',
  'screenshot',
  'unknown',
] as const;
export type UserAttachmentSource = (typeof USER_ATTACHMENT_SOURCES)[number];

export const PROCESS_DISCLOSURE_STATUSES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'incomplete',
] as const;
export type ProcessDisclosureStatus = (typeof PROCESS_DISCLOSURE_STATUSES)[number];

export const ANSWER_TEXT_STATUSES = [
  'streaming',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
  'legacy_unknown',
] as const;
export type AnswerTextStatus = (typeof ANSWER_TEXT_STATUSES)[number];

export const THINKING_ITEM_STATUSES = ['streaming', 'completed'] as const;
export type ThinkingItemStatus = (typeof THINKING_ITEM_STATUSES)[number];

export const ASSISTANT_TEXT_ITEM_STATUSES = [
  'streaming',
  'completed',
  'failed',
  'cancelled_partial',
] as const;
export type AssistantTextItemStatus = (typeof ASSISTANT_TEXT_ITEM_STATUSES)[number];

export const TOOL_ACTIVITY_STATUSES = [
  'requested',
  'awaiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'denied',
  'cancelled',
] as const;
export type ToolActivityStatus = (typeof TOOL_ACTIVITY_STATUSES)[number];

export const BRANCH_SEPARATOR_BLOCK_KINDS = ['branch_separator'] as const;
export type BranchSeparatorBlockKind = (typeof BRANCH_SEPARATOR_BLOCK_KINDS)[number];

export const COMPACTION_ACTIVITY_STATUSES = ['running', 'completed', 'failed'] as const;
export type CompactionActivityStatus = (typeof COMPACTION_ACTIVITY_STATUSES)[number];

export const RETRY_ACTIVITY_STATUSES = [
  'started',
  'failed',
  'completed',
  'exhausted',
  'cancelled',
] as const;
export type RetryActivityStatus = (typeof RETRY_ACTIVITY_STATUSES)[number];

export const RECOVERY_ACTIVITY_STATUSES = [
  'interrupted',
  'manual_retry_requested',
  'manual_rerun_requested',
  'marked_cancelled',
] as const;
export type RecoveryActivityStatus = (typeof RECOVERY_ACTIVITY_STATUSES)[number];

export interface TimelineMessageBase {
  messageId: MessageId | string;
  role: TimelineMessageRole;
  projectId: string;
  sessionId: SessionId | string;
  createdAt: string;
  updatedAt?: string;
  turnOrder?: number;
  historyOrder?: number;
}

export interface TimelineBlockBase {
  blockId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserTextBlock extends TimelineBlockBase {
  kind: 'user_text';
  text: string;
  format: TextFormat;
}

export interface UserAttachmentBlock extends TimelineBlockBase {
  kind: 'user_attachment';
  attachmentId: string;
  attachmentType: 'image' | 'file';
  name: string;
  mediaType?: string;
  sizeBytes?: number;
  source: UserAttachmentSource;
}

export type UserTimelineBlock = UserTextBlock | UserAttachmentBlock;

export interface TimelineUserMessage extends TimelineMessageBase {
  role: 'user';
  runId?: RunId | string;
  clientMessageId?: string;
  blocks: UserTimelineBlock[];
}

export interface BranchSeparatorBlock extends TimelineBlockBase {
  kind: 'branch_separator';
  branchMarkerId: string;
  sourceMessageId: MessageId | string;
  label: string;
}

export interface TimelineSeparatorMessage extends TimelineMessageBase {
  role: 'separator';
  blocks: [BranchSeparatorBlock];
}

export type SessionCompactionActivityStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface SessionCompactionActivityBlock extends TimelineBlockBase {
  kind: 'session_compaction_activity';
  activityId: string;
  status: SessionCompactionActivityStatus;
  label: string;
}

export interface TimelineActivityMessage extends TimelineMessageBase {
  role: 'activity';
  blocks: [SessionCompactionActivityBlock];
}

export interface ProcessDisclosureItemBase {
  itemId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThinkingItem extends ProcessDisclosureItemBase {
  kind: 'thinking';
  thinkingId: string;
  status: ThinkingItemStatus;
  text: string;
  format: TextFormat;
}

export interface AssistantTextItem extends ProcessDisclosureItemBase {
  kind: 'assistant_text';
  textId: string;
  phase: 'prelude';
  status: AssistantTextItemStatus;
  text: string;
  format: TextFormat;
}

export interface ToolActivityItem extends ProcessDisclosureItemBase {
  kind: 'tool_activity';
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
  status: ToolActivityStatus;
  approval?: {
    approvalRequestId: string;
    defaultOptionId: string;
    summary?: string;
    options: Array<{
      optionId: string;
      scope: 'once' | 'session';
      label: string;
      description: string;
    }>;
  };
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export interface PlanActivityItem extends ProcessDisclosureItemBase {
  kind: 'plan_activity';
  toolCallId: ToolCallId | string;
  explanation?: string;
  plan: Array<{
    step: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}

export interface ErrorActivityItem extends ProcessDisclosureItemBase {
  kind: 'error_activity';
  errorCode?: string;
  errorMessage: string;
  recoverable?: boolean;
}

export interface CancelledActivityItem extends ProcessDisclosureItemBase {
  kind: 'cancelled_activity';
  reason?: string;
}

export interface CompactionActivityItem extends ProcessDisclosureItemBase {
  kind: 'compaction_activity';
  compactionId?: string;
  status: CompactionActivityStatus;
  label: string;
}

export interface RetryActivityItem extends ProcessDisclosureItemBase {
  kind: 'retry_activity';
  retryAttemptId: string;
  attemptNumber: number;
  status: RetryActivityStatus;
  label: string;
  reason?: string;
}

export interface RecoveryActivityItem extends ProcessDisclosureItemBase {
  kind: 'recovery_activity';
  status: RecoveryActivityStatus;
  label: string;
}

export type ProcessDisclosureItem =
  | ThinkingItem
  | AssistantTextItem
  | ToolActivityItem
  | PlanActivityItem
  | ErrorActivityItem
  | CancelledActivityItem
  | CompactionActivityItem
  | RetryActivityItem
  | RecoveryActivityItem;

export interface ProcessDisclosureBlock extends TimelineBlockBase {
  kind: 'process_disclosure';
  runId: RunId | string;
  status: ProcessDisclosureStatus;
  startedAt?: string;
  endedAt?: string;
  items: ProcessDisclosureItem[];
}

export interface AnswerTextBlock extends TimelineBlockBase {
  kind: 'answer_text';
  runId: RunId | string;
  textId: string;
  status: AnswerTextStatus;
  text: string;
  format: 'markdown';
}

export type AssistantTimelineBlock = ProcessDisclosureBlock | AnswerTextBlock;

export interface TimelineAssistantMessage extends TimelineMessageBase {
  role: 'assistant';
  runId: RunId | string;
  blocks: AssistantTimelineBlock[];
  workspaceChangeFooter?: WorkspaceChangeFooterFact;
}

export type TimelineMessage = TimelineUserMessage | TimelineAssistantMessage | TimelineSeparatorMessage | TimelineActivityMessage;
export type TimelineBlock = UserTimelineBlock | AssistantTimelineBlock | BranchSeparatorBlock | SessionCompactionActivityBlock;





const TIMELINE_MESSAGE_ROLE_VALUES = [...TIMELINE_MESSAGE_ROLES] as [
  TimelineMessageRole,
  ...TimelineMessageRole[],
];
const TEXT_FORMAT_VALUES = [...TEXT_FORMATS] as [TextFormat, ...TextFormat[]];
const USER_ATTACHMENT_SOURCE_VALUES = [...USER_ATTACHMENT_SOURCES] as [
  UserAttachmentSource,
  ...UserAttachmentSource[],
];
const PROCESS_DISCLOSURE_STATUS_VALUES = [...PROCESS_DISCLOSURE_STATUSES] as [
  ProcessDisclosureStatus,
  ...ProcessDisclosureStatus[],
];
const ANSWER_TEXT_STATUS_VALUES = [...ANSWER_TEXT_STATUSES] as [
  AnswerTextStatus,
  ...AnswerTextStatus[],
];
const THINKING_ITEM_STATUS_VALUES = [...THINKING_ITEM_STATUSES] as [
  ThinkingItemStatus,
  ...ThinkingItemStatus[],
];
const ASSISTANT_TEXT_ITEM_STATUS_VALUES = [...ASSISTANT_TEXT_ITEM_STATUSES] as [
  AssistantTextItemStatus,
  ...AssistantTextItemStatus[],
];
const TOOL_ACTIVITY_STATUS_VALUES = [...TOOL_ACTIVITY_STATUSES] as [
  ToolActivityStatus,
  ...ToolActivityStatus[],
];
const BRANCH_SEPARATOR_BLOCK_KIND_VALUES = [...BRANCH_SEPARATOR_BLOCK_KINDS] as [
  BranchSeparatorBlockKind,
  ...BranchSeparatorBlockKind[],
];
const COMPACTION_ACTIVITY_STATUS_VALUES = [...COMPACTION_ACTIVITY_STATUSES] as [
  CompactionActivityStatus,
  ...CompactionActivityStatus[],
];
const RETRY_ACTIVITY_STATUS_VALUES = [...RETRY_ACTIVITY_STATUSES] as [
  RetryActivityStatus,
  ...RetryActivityStatus[],
];
const RECOVERY_ACTIVITY_STATUS_VALUES = [...RECOVERY_ACTIVITY_STATUSES] as [
  RecoveryActivityStatus,
  ...RecoveryActivityStatus[],
];

export const TimelineMessageRoleSchema = z.enum(TIMELINE_MESSAGE_ROLE_VALUES);
export const TextFormatSchema = z.enum(TEXT_FORMAT_VALUES);
export const UserAttachmentSourceSchema = z.enum(USER_ATTACHMENT_SOURCE_VALUES);
export const ProcessDisclosureStatusSchema = z.enum(PROCESS_DISCLOSURE_STATUS_VALUES);
export const AnswerTextStatusSchema = z.enum(ANSWER_TEXT_STATUS_VALUES);
export const ThinkingItemStatusSchema = z.enum(THINKING_ITEM_STATUS_VALUES);
export const AssistantTextItemStatusSchema = z.enum(ASSISTANT_TEXT_ITEM_STATUS_VALUES);
export const ToolActivityStatusSchema = z.enum(TOOL_ACTIVITY_STATUS_VALUES);
export const BranchSeparatorBlockKindSchema = z.enum(BRANCH_SEPARATOR_BLOCK_KIND_VALUES);
export const CompactionActivityStatusSchema = z.enum(COMPACTION_ACTIVITY_STATUS_VALUES);
export const RetryActivityStatusSchema = z.enum(RETRY_ACTIVITY_STATUS_VALUES);
export const RecoveryActivityStatusSchema = z.enum(RECOVERY_ACTIVITY_STATUS_VALUES);

export const TimelineIdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9:_./-]+$/,
    'Timeline id must contain only letters, numbers, colon, underscore, dot, slash, or hyphen.',
  );

export const TimelineIsoDateTimeSchema = z.string().datetime({ offset: true });

const TimelineBlockBaseShape = {
  blockId: TimelineIdSchema,
  createdAt: TimelineIsoDateTimeSchema.optional(),
  updatedAt: TimelineIsoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const ProcessDisclosureItemBaseShape = {
  itemId: TimelineIdSchema,
  createdAt: TimelineIsoDateTimeSchema.optional(),
  updatedAt: TimelineIsoDateTimeSchema.optional(),
} satisfies z.ZodRawShape;

const TimelineMessageBaseShape = {
  messageId: TimelineIdSchema,
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  createdAt: TimelineIsoDateTimeSchema,
  updatedAt: TimelineIsoDateTimeSchema.optional(),
  turnOrder: z.number().int().nonnegative().optional(),
  historyOrder: z.number().int().nonnegative().optional(),
} satisfies z.ZodRawShape;

const OptionalTextSchema = z.string().optional();

export const UserTextBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('user_text'),
    text: z.string(),
    format: TextFormatSchema,
  })
  .strict() satisfies z.ZodType<UserTextBlock>;

export const UserAttachmentBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('user_attachment'),
    attachmentId: z.string().min(1),
    attachmentType: z.enum(['image', 'file']),
    name: z.string().min(1),
    mediaType: z.string().min(1).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    source: UserAttachmentSourceSchema,
  })
  .strict() satisfies z.ZodType<UserAttachmentBlock>;

export const UserTimelineBlockSchema = z.discriminatedUnion('kind', [
  UserTextBlockSchema,
  UserAttachmentBlockSchema,
]) satisfies z.ZodType<TimelineBlock>;

export const BranchSeparatorBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('branch_separator'),
    branchMarkerId: z.string().min(1),
    sourceMessageId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict() satisfies z.ZodType<BranchSeparatorBlock>;

export const ThinkingItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('thinking'),
    thinkingId: z.string().min(1),
    status: ThinkingItemStatusSchema,
    text: z.string(),
    format: TextFormatSchema,
  })
  .strict() satisfies z.ZodType<ThinkingItem>;

export const AssistantTextItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('assistant_text'),
    textId: z.string().min(1),
    phase: z.literal('prelude'),
    status: AssistantTextItemStatusSchema,
    text: z.string(),
    format: TextFormatSchema,
  })
  .strict() satisfies z.ZodType<AssistantTextItem>;

export const ToolActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('tool_activity'),
    toolCallId: z.string().min(1),
    toolExecutionId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    displayName: z.string().min(1).optional(),
    inputSummary: OptionalTextSchema,
    resultSummary: OptionalTextSchema,
    status: ToolActivityStatusSchema,
    approval: z.object({
      approvalRequestId: z.string().min(1),
      defaultOptionId: z.string().min(1),
      summary: OptionalTextSchema,
      options: z.array(z.object({
        optionId: z.string().min(1),
        scope: z.enum(['once', 'session']),
        label: z.string().min(1),
        description: z.string().min(1),
      }).strict()).min(1).max(2),
    }).strict().optional(),
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    }).strict().optional(),
  })
  .strict() satisfies z.ZodType<ToolActivityItem>;

export const PlanActivityItemSchema = z.object({
  ...ProcessDisclosureItemBaseShape,
  kind: z.literal('plan_activity'),
  toolCallId: z.string().min(1),
  explanation: z.string().optional(),
  plan: z.array(z.object({
    step: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
  }).strict()),
}).strict() satisfies z.ZodType<PlanActivityItem>;

export const ErrorActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('error_activity'),
    errorCode: z.string().min(1).optional(),
    errorMessage: z.string().min(1),
    recoverable: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ErrorActivityItem>;

export const CancelledActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('cancelled_activity'),
    reason: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<CancelledActivityItem>;

export const CompactionActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('compaction_activity'),
    compactionId: z.string().min(1).optional(),
    status: CompactionActivityStatusSchema,
    label: z.string().min(1),
  })
  .strict() satisfies z.ZodType<CompactionActivityItem>;

export const RetryActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('retry_activity'),
    retryAttemptId: z.string().min(1),
    attemptNumber: z.number().int().positive(),
    status: RetryActivityStatusSchema,
    label: z.string().min(1),
    reason: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<RetryActivityItem>;

export const RecoveryActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('recovery_activity'),
    status: RecoveryActivityStatusSchema,
    label: z.string().min(1),
  })
  .strict() satisfies z.ZodType<RecoveryActivityItem>;

export const ProcessDisclosureItemSchema = z.discriminatedUnion('kind', [
  ThinkingItemSchema,
  AssistantTextItemSchema,
  ToolActivityItemSchema,
  PlanActivityItemSchema,
  ErrorActivityItemSchema,
  CancelledActivityItemSchema,
  CompactionActivityItemSchema,
  RetryActivityItemSchema,
  RecoveryActivityItemSchema,
]) satisfies z.ZodType<ProcessDisclosureItem>;

export const ProcessDisclosureBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('process_disclosure'),
    runId: z.string().min(1),
    status: ProcessDisclosureStatusSchema,
    startedAt: TimelineIsoDateTimeSchema.optional(),
    endedAt: TimelineIsoDateTimeSchema.optional(),
    items: z.array(ProcessDisclosureItemSchema),
  })
  .strict() satisfies z.ZodType<ProcessDisclosureBlock>;

export const AnswerTextBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('answer_text'),
    runId: z.string().min(1),
    textId: z.string().min(1),
    status: AnswerTextStatusSchema,
    text: z.string(),
    format: z.literal('markdown'),
  })
  .strict() satisfies z.ZodType<AnswerTextBlock>;

export const AssistantTimelineBlockSchema = z.discriminatedUnion('kind', [
  ProcessDisclosureBlockSchema,
  AnswerTextBlockSchema,
]) satisfies z.ZodType<TimelineBlock>;

export const TimelineUserMessageSchema = z
  .object({
    ...TimelineMessageBaseShape,
    role: z.literal('user'),
    runId: z.string().min(1).optional(),
    clientMessageId: TimelineIdSchema.optional(),
    blocks: z.array(UserTimelineBlockSchema).min(1),
  })
  .strict() satisfies z.ZodType<TimelineUserMessage>;

export const TimelineAssistantMessageSchema = z
  .object({
    ...TimelineMessageBaseShape,
    role: z.literal('assistant'),
    runId: z.string().min(1),
    blocks: z.array(AssistantTimelineBlockSchema).min(1),
    workspaceChangeFooter: WorkspaceChangeFooterFactSchema.optional(),
  })
  .strict()
  .superRefine((message, ctx) => {
    const processBlockCount = message.blocks.filter(
      (block) => block.kind === 'process_disclosure',
    ).length;
    const answerBlockCount = message.blocks.filter((block) => block.kind === 'answer_text').length;

    if (processBlockCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blocks'],
        message: 'Assistant messages may contain at most one ProcessDisclosureBlock.',
      });
    }

    if (answerBlockCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blocks'],
        message: 'Assistant messages may contain at most one AnswerTextBlock.',
      });
    }
  }) satisfies z.ZodType<TimelineAssistantMessage>;

export const TimelineSeparatorMessageSchema = z
  .object({
    ...TimelineMessageBaseShape,
    role: z.literal('separator'),
    blocks: z.tuple([BranchSeparatorBlockSchema]),
  })
  .strict() satisfies z.ZodType<TimelineSeparatorMessage>;

export const SessionCompactionActivityBlockSchema = z
  .object({
    ...TimelineBlockBaseShape,
    kind: z.literal('session_compaction_activity'),
    activityId: z.string().min(1),
    status: z.enum(['running', 'completed', 'failed', 'skipped']),
    label: z.string().min(1),
  })
  .strict() satisfies z.ZodType<SessionCompactionActivityBlock>;

export const TimelineActivityMessageSchema = z
  .object({
    ...TimelineMessageBaseShape,
    role: z.literal('activity'),
    blocks: z.tuple([SessionCompactionActivityBlockSchema]),
  })
  .strict() satisfies z.ZodType<TimelineActivityMessage>;

export const TimelineMessageSchema = z.union([
  TimelineUserMessageSchema,
  TimelineAssistantMessageSchema,
  TimelineSeparatorMessageSchema,
  TimelineActivityMessageSchema,
]) satisfies z.ZodType<TimelineMessage>;

export type TimelineMessageFromSchema = z.infer<typeof TimelineMessageSchema>;
