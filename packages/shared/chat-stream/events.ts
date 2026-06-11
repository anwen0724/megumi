import type {
  MessageId,
  RunId,
  SessionId,
  ToolCallId,
  ToolExecutionId,
  ToolResultId,
} from '../primitives/ids';
import type { WorkspaceChangeFooterFact } from '../workspace/change-contracts';

export const CHAT_STREAM_EVENT_TYPES = [
  'turn.started',
  'turn.completed',
  'turn.failed',
  'turn.cancelled',
  'user.message.committed',
  'assistant.text.started',
  'assistant.text.delta',
  'assistant.text.reclassified',
  'assistant.text.completed',
  'assistant.text.failed',
  'assistant.text.cancelled_partial',
  'assistant.thinking.started',
  'assistant.thinking.delta',
  'assistant.thinking.completed',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'tool.denied',
  'approval.requested',
  'approval.resolved',
  'branch.separator.created',
  'branch.separator.removed',
  'process.compaction.recorded',
  'process.retry.recorded',
  'process.recovery.recorded',
  'workspace.change.footer.updated',
] as const;

export type ChatStreamEventType = (typeof CHAT_STREAM_EVENT_TYPES)[number];

export const ASSISTANT_TEXT_PHASES = ['prelude', 'answer'] as const;
export type AssistantTextPhase = (typeof ASSISTANT_TEXT_PHASES)[number];

export const APPROVAL_REQUEST_STATUSES = ['pending'] as const;
export type ApprovalRequestStatus = (typeof APPROVAL_REQUEST_STATUSES)[number];

export const APPROVAL_RESOLUTION_STATUSES = [
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type ApprovalResolutionStatus = (typeof APPROVAL_RESOLUTION_STATUSES)[number];

export type ChatStreamKind = 'main' | (string & {});
export type ChatStreamApprovalScope = 'user' | 'project' | 'local' | (string & {});

export interface ChatStreamEventBase {
  eventId: string;
  eventType: ChatStreamEventType;
  projectId: string;
  sessionId: SessionId | string;
  runId: RunId | string;
  streamId: string;
  streamKind: ChatStreamKind;
  seq: number;
  createdAt: string;
}

export interface TurnStartedEvent extends ChatStreamEventBase {
  eventType: 'turn.started';
  userMessageId: MessageId | string;
  clientMessageId?: string;
}

export interface TurnCompletedEvent extends ChatStreamEventBase {
  eventType: 'turn.completed';
  elapsedMs?: number;
}

export interface TurnFailedEvent extends ChatStreamEventBase {
  eventType: 'turn.failed';
  errorCode?: string;
  errorMessage?: string;
  recoverable?: boolean;
}

export interface TurnCancelledEvent extends ChatStreamEventBase {
  eventType: 'turn.cancelled';
  reason?: string;
}

export interface UserMessageCommittedEvent extends ChatStreamEventBase {
  eventType: 'user.message.committed';
  clientMessageId: string;
  messageId: MessageId | string;
  text: string;
  attachments?: unknown[];
}

export interface AssistantTextStartedEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.started';
  textId: string;
  phase: AssistantTextPhase;
}

export interface AssistantTextDeltaEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.delta';
  textId: string;
  phase: AssistantTextPhase;
  delta: string;
}

export interface AssistantTextReclassifiedEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.reclassified';
  textId: string;
  fromPhase: AssistantTextPhase;
  toPhase: AssistantTextPhase;
}

export interface AssistantTextCompletedEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.completed';
  textId: string;
  phase: AssistantTextPhase;
}

export interface AssistantTextFailedEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.failed';
  textId: string;
  phase: AssistantTextPhase;
  errorCode?: string;
  errorMessage?: string;
}

export interface AssistantTextCancelledPartialEvent extends ChatStreamEventBase {
  eventType: 'assistant.text.cancelled_partial';
  textId: string;
  phase: AssistantTextPhase;
  reason?: string;
}

export interface AssistantThinkingStartedEvent extends ChatStreamEventBase {
  eventType: 'assistant.thinking.started';
  thinkingId: string;
}

export interface AssistantThinkingDeltaEvent extends ChatStreamEventBase {
  eventType: 'assistant.thinking.delta';
  thinkingId: string;
  delta: string;
}

export interface AssistantThinkingCompletedEvent extends ChatStreamEventBase {
  eventType: 'assistant.thinking.completed';
  thinkingId: string;
}

export interface ToolStartedEvent extends ChatStreamEventBase {
  eventType: 'tool.started';
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
}

export interface ToolCompletedEvent extends ChatStreamEventBase {
  eventType: 'tool.completed';
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  toolResultId?: ToolResultId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
}

export interface ToolFailedEvent extends ChatStreamEventBase {
  eventType: 'tool.failed';
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  toolResultId?: ToolResultId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ToolDeniedEvent extends ChatStreamEventBase {
  eventType: 'tool.denied';
  toolCallId: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  toolResultId?: ToolResultId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  reason?: string;
}

export interface ApprovalRequestedEvent extends ChatStreamEventBase {
  eventType: 'approval.requested';
  approvalId: string;
  toolCallId?: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  scope: ChatStreamApprovalScope;
  status: 'pending';
  title: string;
  description?: string;
  subjectSummary?: string;
}

export interface ApprovalResolvedEvent extends ChatStreamEventBase {
  eventType: 'approval.resolved';
  approvalId: string;
  toolCallId?: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  scope: ChatStreamApprovalScope;
  status: ApprovalResolutionStatus;
  decision?: ApprovalResolutionStatus;
}

export interface BranchSeparatorCreatedEvent extends ChatStreamEventBase {
  eventType: 'branch.separator.created';
  branchMarkerId: string;
  sourceMessageId: MessageId | string;
  label: string;
}

export interface BranchSeparatorRemovedEvent extends ChatStreamEventBase {
  eventType: 'branch.separator.removed';
  branchMarkerId: string;
}

export interface ProcessCompactionRecordedEvent extends ChatStreamEventBase {
  eventType: 'process.compaction.recorded';
  compactionId?: string;
  status: 'completed' | 'skipped' | 'boundary_unresolved';
  label: string;
}

export interface ProcessRetryRecordedEvent extends ChatStreamEventBase {
  eventType: 'process.retry.recorded';
  retryAttemptId: string;
  attemptNumber: number;
  status: 'started' | 'failed' | 'completed' | 'exhausted' | 'cancelled';
  label: string;
  reason?: string;
}

export interface ProcessRecoveryRecordedEvent extends ChatStreamEventBase {
  eventType: 'process.recovery.recorded';
  status: 'interrupted' | 'manual_retry_requested' | 'manual_rerun_requested' | 'marked_cancelled';
  label: string;
}

export interface WorkspaceChangeFooterUpdatedEvent extends ChatStreamEventBase {
  eventType: 'workspace.change.footer.updated';
  footer: WorkspaceChangeFooterFact;
}

export type ChatStreamEvent =
  | TurnStartedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnCancelledEvent
  | UserMessageCommittedEvent
  | AssistantTextStartedEvent
  | AssistantTextDeltaEvent
  | AssistantTextReclassifiedEvent
  | AssistantTextCompletedEvent
  | AssistantTextFailedEvent
  | AssistantTextCancelledPartialEvent
  | AssistantThinkingStartedEvent
  | AssistantThinkingDeltaEvent
  | AssistantThinkingCompletedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolDeniedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | BranchSeparatorCreatedEvent
  | BranchSeparatorRemovedEvent
  | ProcessCompactionRecordedEvent
  | ProcessRetryRecordedEvent
  | ProcessRecoveryRecordedEvent
  | WorkspaceChangeFooterUpdatedEvent;

export type TypedChatStreamEvent<TType extends ChatStreamEventType> = Extract<
  ChatStreamEvent,
  { eventType: TType }
>;

