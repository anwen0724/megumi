import { z } from 'zod';
import {
  APPROVAL_REQUEST_STATUSES,
  APPROVAL_RESOLUTION_STATUSES,
  ASSISTANT_TEXT_PHASES,
  CHAT_STREAM_EVENT_TYPES,
  type ApprovalRequestStatus,
  type ApprovalResolutionStatus,
  type AssistantTextPhase,
  type ChatStreamEvent,
  type ChatStreamEventType,
} from './chat-stream-events';

const CHAT_STREAM_EVENT_TYPE_VALUES = [...CHAT_STREAM_EVENT_TYPES] as [
  ChatStreamEventType,
  ...ChatStreamEventType[],
];
const ASSISTANT_TEXT_PHASE_VALUES = [...ASSISTANT_TEXT_PHASES] as [
  AssistantTextPhase,
  ...AssistantTextPhase[],
];
const APPROVAL_REQUEST_STATUS_VALUES = [...APPROVAL_REQUEST_STATUSES] as [
  ApprovalRequestStatus,
  ...ApprovalRequestStatus[],
];
const APPROVAL_RESOLUTION_STATUS_VALUES = [...APPROVAL_RESOLUTION_STATUSES] as [
  ApprovalResolutionStatus,
  ...ApprovalResolutionStatus[],
];

export const ChatStreamEventTypeSchema = z.enum(CHAT_STREAM_EVENT_TYPE_VALUES);
export const AssistantTextPhaseSchema = z.enum(ASSISTANT_TEXT_PHASE_VALUES);
export const ApprovalRequestStatusSchema = z.enum(APPROVAL_REQUEST_STATUS_VALUES);
export const ApprovalResolutionStatusSchema = z.enum(APPROVAL_RESOLUTION_STATUS_VALUES);

export const ChatStreamEventIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z0-9:_-]+$/,
    'Chat stream event id must contain only letters, numbers, colon, underscore, or hyphen.',
  );

export const ChatStreamSeqSchema = z.number().int().positive();
export const ChatStreamIsoDateTimeSchema = z.string().datetime({ offset: true });

const ChatStreamEventBaseShape = {
  eventId: ChatStreamEventIdSchema,
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  streamId: z.string().min(1),
  streamKind: z.string().min(1),
  seq: ChatStreamSeqSchema,
  createdAt: ChatStreamIsoDateTimeSchema,
} satisfies z.ZodRawShape;

function chatStreamEventSchema<TType extends ChatStreamEventType, TShape extends z.ZodRawShape>(
  eventType: TType,
  shape: TShape,
) {
  return z
    .object({
      ...ChatStreamEventBaseShape,
      eventType: z.literal(eventType),
      ...shape,
    })
    .strict()
    .superRefine((event, ctx) => {
      if (event.streamId === event.runId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['streamId'],
          message: 'streamId must be independent from runId.',
        });
      }
    });
}

const OptionalTextSchema = z.string().optional();

export const TurnStartedEventSchema = chatStreamEventSchema('turn.started', {
  userMessageId: z.string().min(1),
  clientMessageId: z.string().min(1).optional(),
});

export const TurnCompletedEventSchema = chatStreamEventSchema('turn.completed', {
  elapsedMs: z.number().int().nonnegative().optional(),
});

export const TurnFailedEventSchema = chatStreamEventSchema('turn.failed', {
  errorCode: z.string().min(1).optional(),
  errorMessage: OptionalTextSchema,
  recoverable: z.boolean().optional(),
});

export const TurnCancelledEventSchema = chatStreamEventSchema('turn.cancelled', {
  reason: z.string().min(1).optional(),
});

export const UserMessageCommittedEventSchema = chatStreamEventSchema('user.message.committed', {
  clientMessageId: z.string().min(1),
  messageId: z.string().min(1),
  text: z.string(),
  attachments: z.array(z.unknown()).optional(),
});

export const AssistantTextStartedEventSchema = chatStreamEventSchema('assistant.text.started', {
  textId: z.string().min(1),
  phase: AssistantTextPhaseSchema,
});

export const AssistantTextDeltaEventSchema = chatStreamEventSchema('assistant.text.delta', {
  textId: z.string().min(1),
  phase: AssistantTextPhaseSchema,
  delta: z.string(),
});

export const AssistantTextCompletedEventSchema = chatStreamEventSchema('assistant.text.completed', {
  textId: z.string().min(1),
  phase: AssistantTextPhaseSchema,
});

export const AssistantTextFailedEventSchema = chatStreamEventSchema('assistant.text.failed', {
  textId: z.string().min(1),
  phase: AssistantTextPhaseSchema,
  errorCode: z.string().min(1).optional(),
  errorMessage: OptionalTextSchema,
});

export const AssistantTextCancelledPartialEventSchema = chatStreamEventSchema(
  'assistant.text.cancelled_partial',
  {
    textId: z.string().min(1),
    phase: AssistantTextPhaseSchema,
    reason: z.string().min(1).optional(),
  },
);

export const AssistantThinkingStartedEventSchema = chatStreamEventSchema(
  'assistant.thinking.started',
  {
    thinkingId: z.string().min(1),
  },
);

export const AssistantThinkingDeltaEventSchema = chatStreamEventSchema(
  'assistant.thinking.delta',
  {
    thinkingId: z.string().min(1),
    delta: z.string(),
  },
);

export const AssistantThinkingCompletedEventSchema = chatStreamEventSchema(
  'assistant.thinking.completed',
  {
    thinkingId: z.string().min(1),
  },
);

const ToolActivityBaseShape = {
  toolCallId: z.string().min(1),
  toolExecutionId: z.string().min(1).optional(),
  toolName: z.string().min(1),
  displayName: z.string().min(1).optional(),
  inputSummary: OptionalTextSchema,
} satisfies z.ZodRawShape;

export const ToolStartedEventSchema = chatStreamEventSchema('tool.started', ToolActivityBaseShape);

export const ToolCompletedEventSchema = chatStreamEventSchema('tool.completed', {
  ...ToolActivityBaseShape,
  toolResultId: z.string().min(1).optional(),
  resultSummary: OptionalTextSchema,
});

export const ToolFailedEventSchema = chatStreamEventSchema('tool.failed', {
  ...ToolActivityBaseShape,
  toolResultId: z.string().min(1).optional(),
  resultSummary: OptionalTextSchema,
  errorCode: z.string().min(1).optional(),
  errorMessage: OptionalTextSchema,
});

export const ToolDeniedEventSchema = chatStreamEventSchema('tool.denied', {
  ...ToolActivityBaseShape,
  toolResultId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});

export const ApprovalRequestedEventSchema = chatStreamEventSchema('approval.requested', {
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  toolExecutionId: z.string().min(1).optional(),
  scope: z.string().min(1),
  status: ApprovalRequestStatusSchema,
  title: z.string().min(1),
  description: OptionalTextSchema,
  subjectSummary: OptionalTextSchema,
});

export const ApprovalResolvedEventSchema = chatStreamEventSchema('approval.resolved', {
  approvalId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  toolExecutionId: z.string().min(1).optional(),
  scope: z.string().min(1),
  status: ApprovalResolutionStatusSchema,
  decision: ApprovalResolutionStatusSchema.optional(),
});

export const BranchSeparatorCreatedEventSchema = chatStreamEventSchema('branch.separator.created', {
  branchMarkerId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  label: z.string().min(1),
});

export const BranchSeparatorRemovedEventSchema = chatStreamEventSchema('branch.separator.removed', {
  branchMarkerId: z.string().min(1),
});

export const ProcessCompactionRecordedEventSchema = chatStreamEventSchema(
  'process.compaction.recorded',
  {
    compactionId: z.string().min(1).optional(),
    status: z.enum(['completed', 'skipped', 'boundary_unresolved']),
    label: z.string().min(1),
  },
);

export const ProcessRetryRecordedEventSchema = chatStreamEventSchema('process.retry.recorded', {
  retryAttemptId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  status: z.enum(['started', 'failed', 'completed', 'exhausted', 'cancelled']),
  label: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const ProcessRecoveryRecordedEventSchema = chatStreamEventSchema(
  'process.recovery.recorded',
  {
    status: z.enum([
      'interrupted',
      'manual_retry_requested',
      'manual_rerun_requested',
      'marked_cancelled',
    ]),
    label: z.string().min(1),
  },
);

const ChatStreamEventUnionSchema = z.union([
  TurnStartedEventSchema,
  TurnCompletedEventSchema,
  TurnFailedEventSchema,
  TurnCancelledEventSchema,
  UserMessageCommittedEventSchema,
  AssistantTextStartedEventSchema,
  AssistantTextDeltaEventSchema,
  AssistantTextCompletedEventSchema,
  AssistantTextFailedEventSchema,
  AssistantTextCancelledPartialEventSchema,
  AssistantThinkingStartedEventSchema,
  AssistantThinkingDeltaEventSchema,
  AssistantThinkingCompletedEventSchema,
  ToolStartedEventSchema,
  ToolCompletedEventSchema,
  ToolFailedEventSchema,
  ToolDeniedEventSchema,
  ApprovalRequestedEventSchema,
  ApprovalResolvedEventSchema,
  BranchSeparatorCreatedEventSchema,
  BranchSeparatorRemovedEventSchema,
  ProcessCompactionRecordedEventSchema,
  ProcessRetryRecordedEventSchema,
  ProcessRecoveryRecordedEventSchema,
]);

export const ChatStreamEventSchema = ChatStreamEventUnionSchema satisfies z.ZodType<ChatStreamEvent>;

export type ChatStreamEventFromSchema = z.infer<typeof ChatStreamEventSchema>;
