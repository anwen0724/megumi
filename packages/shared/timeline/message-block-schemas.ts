import { z } from 'zod';
import {
  ANSWER_TEXT_STATUSES,
  APPROVAL_ACTIVITY_STATUSES,
  ASSISTANT_TEXT_ITEM_STATUSES,
  BRANCH_SEPARATOR_BLOCK_KINDS,
  COMPACTION_ACTIVITY_STATUSES,
  PROCESS_DISCLOSURE_STATUSES,
  RECOVERY_ACTIVITY_STATUSES,
  RETRY_ACTIVITY_STATUSES,
  TEXT_FORMATS,
  THINKING_ITEM_STATUSES,
  TIMELINE_MESSAGE_ROLES,
  TOOL_ACTIVITY_STATUSES,
  USER_ATTACHMENT_SOURCES,
  type AnswerTextBlock,
  type AnswerTextStatus,
  type ApprovalActivityItem,
  type ApprovalActivityStatus,
  type AssistantTextItem,
  type AssistantTextItemStatus,
  type BranchSeparatorBlock,
  type BranchSeparatorBlockKind,
  type CancelledActivityItem,
  type CompactionActivityItem,
  type CompactionActivityStatus,
  type ErrorActivityItem,
  type ProcessDisclosureBlock,
  type ProcessDisclosureItem,
  type ProcessDisclosureStatus,
  type RecoveryActivityItem,
  type RecoveryActivityStatus,
  type RetryActivityItem,
  type RetryActivityStatus,
  type TextFormat,
  type ThinkingItem,
  type ThinkingItemStatus,
  type TimelineAssistantMessage,
  type TimelineBlock,
  type TimelineMessage,
  type TimelineMessageRole,
  type TimelineSeparatorMessage,
  type TimelineUserMessage,
  type ToolActivityItem,
  type ToolActivityStatus,
  type UserAttachmentBlock,
  type UserAttachmentSource,
  type UserTextBlock,
} from '../timeline/message-blocks';
import { WorkspaceChangeFooterFactSchema } from '../workspace/change-contracts';

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
const APPROVAL_ACTIVITY_STATUS_VALUES = [...APPROVAL_ACTIVITY_STATUSES] as [
  ApprovalActivityStatus,
  ...ApprovalActivityStatus[],
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
export const ApprovalActivityStatusSchema = z.enum(APPROVAL_ACTIVITY_STATUS_VALUES);
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
    toolResultId: z.string().min(1).optional(),
    toolName: z.string().min(1),
    displayName: z.string().min(1).optional(),
    inputSummary: OptionalTextSchema,
    resultSummary: OptionalTextSchema,
    status: ToolActivityStatusSchema,
  })
  .strict() satisfies z.ZodType<ToolActivityItem>;

export const ApprovalActivityItemSchema = z
  .object({
    ...ProcessDisclosureItemBaseShape,
    kind: z.literal('approval_activity'),
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
    toolExecutionId: z.string().min(1).optional(),
    scope: z.string().min(1),
    status: ApprovalActivityStatusSchema,
    title: z.string().min(1),
    description: OptionalTextSchema,
    subjectSummary: OptionalTextSchema,
  })
  .strict() satisfies z.ZodType<ApprovalActivityItem>;

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
  ApprovalActivityItemSchema,
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

export const TimelineMessageSchema = z.union([
  TimelineUserMessageSchema,
  TimelineAssistantMessageSchema,
  TimelineSeparatorMessageSchema,
]) satisfies z.ZodType<TimelineMessage>;

export type TimelineMessageFromSchema = z.infer<typeof TimelineMessageSchema>;

