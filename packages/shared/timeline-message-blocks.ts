import type {
  MessageId,
  RunId,
  SessionId,
  ToolCallId,
  ToolExecutionId,
  ToolResultId,
} from './ids';

export const TIMELINE_MESSAGE_ROLES = ['user', 'assistant'] as const;
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
] as const;
export type ProcessDisclosureStatus = (typeof PROCESS_DISCLOSURE_STATUSES)[number];

export const ANSWER_TEXT_STATUSES = [
  'streaming',
  'completed',
  'failed',
  'cancelled_partial',
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
  'running',
  'succeeded',
  'failed',
  'denied',
] as const;
export type ToolActivityStatus = (typeof TOOL_ACTIVITY_STATUSES)[number];

export const APPROVAL_ACTIVITY_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type ApprovalActivityStatus = (typeof APPROVAL_ACTIVITY_STATUSES)[number];

export interface TimelineMessageBase {
  messageId: MessageId | string;
  role: TimelineMessageRole;
  projectId: string;
  sessionId: SessionId | string;
  createdAt: string;
  updatedAt?: string;
  turnOrder?: number;
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
  toolResultId?: ToolResultId | string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
  status: ToolActivityStatus;
}

export interface ApprovalActivityItem extends ProcessDisclosureItemBase {
  kind: 'approval_activity';
  approvalId: string;
  toolCallId?: ToolCallId | string;
  toolExecutionId?: ToolExecutionId | string;
  scope: string;
  status: ApprovalActivityStatus;
  title: string;
  description?: string;
  subjectSummary?: string;
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

export type ProcessDisclosureItem =
  | ThinkingItem
  | AssistantTextItem
  | ToolActivityItem
  | ApprovalActivityItem
  | ErrorActivityItem
  | CancelledActivityItem;

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
}

export type TimelineMessage = TimelineUserMessage | TimelineAssistantMessage;
export type TimelineBlock = UserTimelineBlock | AssistantTimelineBlock;
