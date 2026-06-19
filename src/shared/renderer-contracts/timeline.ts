// Renderer-facing timeline message contracts and chat stream reducer.
import type { AssistantTextPhase, ChatStreamEvent } from './chat-stream';
import type { WorkspaceChangeFooterFact } from './workspace';

export type TimelineMessageRole = 'user' | 'assistant' | 'separator';
export type TextFormat = 'plain' | 'markdown';

export interface TimelineMessageBase {
  messageId: string;
  role: TimelineMessageRole;
  projectId: string;
  sessionId: string;
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
  source: string;
}

export type UserTimelineBlock = UserTextBlock | UserAttachmentBlock;

export interface TimelineUserMessage extends TimelineMessageBase {
  role: 'user';
  runId?: string;
  clientMessageId?: string;
  blocks: UserTimelineBlock[];
}

export interface BranchSeparatorBlock extends TimelineBlockBase {
  kind: 'branch_separator';
  branchMarkerId: string;
  sourceMessageId: string;
  label: string;
}

export interface TimelineSeparatorMessage extends TimelineMessageBase {
  role: 'separator';
  blocks: [BranchSeparatorBlock];
}

export interface ProcessDisclosureItemBase {
  itemId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ThinkingItem extends ProcessDisclosureItemBase {
  kind: 'thinking';
  thinkingId: string;
  status: 'streaming' | 'completed';
  text: string;
  format: TextFormat;
}

export interface AssistantTextItem extends ProcessDisclosureItemBase {
  kind: 'assistant_text';
  textId: string;
  phase: 'prelude';
  status: 'streaming' | 'completed' | 'failed' | 'cancelled_partial';
  text: string;
  format: TextFormat;
}

export interface ToolActivityItem extends ProcessDisclosureItemBase {
  kind: 'tool_activity';
  toolCallId: string;
  toolExecutionId?: string;
  toolResultId?: string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
  status: 'running' | 'succeeded' | 'failed' | 'denied';
}

export interface ApprovalActivityItem extends ProcessDisclosureItemBase {
  kind: 'approval_activity';
  approvalId: string;
  toolCallId?: string;
  toolExecutionId?: string;
  scope: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
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

export interface CompactionActivityItem extends ProcessDisclosureItemBase {
  kind: 'compaction_activity';
  compactionId?: string;
  status: 'completed' | 'skipped' | 'boundary_unresolved';
  label: string;
}

export interface RetryActivityItem extends ProcessDisclosureItemBase {
  kind: 'retry_activity';
  retryAttemptId: string;
  attemptNumber: number;
  status: 'started' | 'failed' | 'completed' | 'exhausted' | 'cancelled';
  label: string;
  reason?: string;
}

export interface RecoveryActivityItem extends ProcessDisclosureItemBase {
  kind: 'recovery_activity';
  status: 'interrupted' | 'manual_retry_requested' | 'manual_rerun_requested' | 'marked_cancelled';
  label: string;
}

export type ProcessDisclosureItem =
  | ThinkingItem
  | AssistantTextItem
  | ToolActivityItem
  | ApprovalActivityItem
  | ErrorActivityItem
  | CancelledActivityItem
  | CompactionActivityItem
  | RetryActivityItem
  | RecoveryActivityItem;

export interface ProcessDisclosureBlock extends TimelineBlockBase {
  kind: 'process_disclosure';
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: string;
  endedAt?: string;
  items: ProcessDisclosureItem[];
}

export interface AnswerTextBlock extends TimelineBlockBase {
  kind: 'answer_text';
  runId: string;
  textId: string;
  status: 'streaming' | 'completed' | 'failed' | 'cancelled_partial';
  text: string;
  format: 'markdown';
}

export type AssistantTimelineBlock = ProcessDisclosureBlock | AnswerTextBlock;

export interface TimelineAssistantMessage extends TimelineMessageBase {
  role: 'assistant';
  runId: string;
  blocks: AssistantTimelineBlock[];
  workspaceChangeFooter?: WorkspaceChangeFooterFact;
}

export type TimelineMessage = TimelineUserMessage | TimelineAssistantMessage | TimelineSeparatorMessage;
export type TimelineBlock = UserTimelineBlock | AssistantTimelineBlock | BranchSeparatorBlock;

export function reduceChatStreamEvent(messages: TimelineMessage[], event: ChatStreamEvent): TimelineMessage[] {
  return reduceLegacyChatStreamEvent(messages, event);
}

function cloneMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return messages.map((message) => {
    if (message.role === 'assistant') {
      return {
        ...message,
        workspaceChangeFooter: message.workspaceChangeFooter
          ? {
              ...message.workspaceChangeFooter,
              changeSets: message.workspaceChangeFooter.changeSets.map((changeSet) => ({
                ...changeSet,
                files: changeSet.files.map((file) => ({ ...file })),
              })),
            }
          : undefined,
        blocks: message.blocks.map((block) => block.kind === 'process_disclosure'
          ? { ...block, items: block.items.map((item) => ({ ...item })) }
          : { ...block }) as AssistantTimelineBlock[],
      };
    }
    return { ...message, blocks: message.blocks.map((block) => ({ ...block })) } as TimelineMessage;
  });
}

function ensureAssistantMessage(messages: TimelineMessage[], event: ChatStreamEvent): TimelineAssistantMessage {
  const messageId = `assistant:${event.runId}`;
  const existing = messages.find((message): message is TimelineAssistantMessage =>
    message.role === 'assistant' && message.messageId === messageId
  );
  if (existing) return existing;
  const assistant: TimelineAssistantMessage = {
    messageId,
    role: 'assistant',
    runId: event.runId,
    turnOrder: 1,
    projectId: event.projectId,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    blocks: [],
  };
  messages.push(assistant);
  return assistant;
}

function ensureProcessBlock(assistant: TimelineAssistantMessage, event: ChatStreamEvent): ProcessDisclosureBlock {
  const blockId = `process:${event.runId}`;
  const existing = assistant.blocks.find(
    (block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure' && block.blockId === blockId,
  );
  if (existing) return existing;
  const block: ProcessDisclosureBlock = {
    blockId,
    kind: 'process_disclosure',
    runId: event.runId,
    status: 'running',
    startedAt: event.createdAt,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    items: [],
  };
  assistant.blocks.unshift(block);
  return block;
}

function ensureAnswerBlock(assistant: TimelineAssistantMessage, event: ChatStreamEvent, textId: string): AnswerTextBlock {
  const blockId = `answer:${event.runId}`;
  const existing = assistant.blocks.find(
    (block): block is AnswerTextBlock => block.kind === 'answer_text' && block.blockId === blockId,
  );
  if (existing) return existing;
  const block: AnswerTextBlock = {
    blockId,
    kind: 'answer_text',
    runId: event.runId,
    textId,
    status: 'streaming',
    text: '',
    format: 'markdown',
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  assistant.blocks.push(block);
  return block;
}

function upsertProcessItem(block: ProcessDisclosureBlock, item: ProcessDisclosureItem): void {
  const index = block.items.findIndex((candidate) => candidate.itemId === item.itemId);
  if (index === -1) {
    block.items.push(item);
  } else {
    block.items[index] = { ...block.items[index], ...item } as ProcessDisclosureItem;
  }
}

function ensureThinkingItem(
  process: ProcessDisclosureBlock,
  thinkingId: string,
  createdAt: string,
): ThinkingItem {
  const itemId = `thinking:${thinkingId}`;
  const existing = process.items.find(
    (item): item is ThinkingItem => item.kind === 'thinking' && item.itemId === itemId,
  );
  if (existing) return existing;
  const item: ThinkingItem = {
    itemId,
    kind: 'thinking',
    thinkingId,
    status: 'streaming',
    text: '',
    format: 'plain',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensurePreludeTextItem(
  process: ProcessDisclosureBlock,
  textId: string,
  createdAt: string,
): AssistantTextItem {
  const itemId = `prelude:${textId}`;
  const existing = process.items.find(
    (item): item is AssistantTextItem => item.kind === 'assistant_text' && item.itemId === itemId,
  );
  if (existing) return existing;
  const item: AssistantTextItem = {
    itemId,
    kind: 'assistant_text',
    textId,
    phase: 'prelude',
    status: 'streaming',
    text: '',
    format: 'markdown',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function reclassifyAssistantTextBlock(
  assistant: TimelineAssistantMessage,
  process: ProcessDisclosureBlock,
  event: ChatStreamEvent & {
    eventType: 'assistant.text.reclassified';
    textId: string;
    fromPhase: AssistantTextPhase;
    toPhase: AssistantTextPhase;
  },
): void {
  if (event.fromPhase !== 'answer' || event.toPhase !== 'prelude') return;
  const answerIndex = assistant.blocks.findIndex(
    (block): block is AnswerTextBlock => block.kind === 'answer_text' && block.textId === event.textId,
  );
  if (answerIndex === -1) return;
  const answer = assistant.blocks[answerIndex] as AnswerTextBlock;
  assistant.blocks.splice(answerIndex, 1);
  const item = ensurePreludeTextItem(process, event.textId, event.createdAt);
  item.text = answer.text;
  item.status = answer.status;
  item.updatedAt = event.createdAt;
}

function reduceLegacyChatStreamEvent(messages: TimelineMessage[], event: ChatStreamEvent): TimelineMessage[] {
  const nextMessages = cloneMessages(messages);

  if (event.eventType === 'user.message.committed') {
    const messageId = String(event.messageId);
    const text = String(event.text ?? '');
    const existing = nextMessages.find((message): message is TimelineUserMessage =>
      message.role === 'user' && message.messageId === messageId
    );
    const block: UserTextBlock = {
      blockId: `user-text:${messageId}`,
      kind: 'user_text',
      text,
      format: 'plain',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    };
    if (existing) {
      existing.blocks = [block];
      existing.updatedAt = event.createdAt;
      return nextMessages;
    }
    nextMessages.push({
      messageId,
      role: 'user',
      projectId: event.projectId,
      sessionId: event.sessionId,
      runId: event.runId,
      clientMessageId: String(event.clientMessageId ?? ''),
      turnOrder: 0,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      blocks: [block],
    });
    return nextMessages;
  }

  if (event.eventType === 'branch.separator.created') {
    nextMessages.push({
      messageId: `separator:${String(event.branchMarkerId)}`,
      role: 'separator',
      projectId: event.projectId,
      sessionId: event.sessionId,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      blocks: [{
        blockId: `branch-separator:${String(event.branchMarkerId)}`,
        kind: 'branch_separator',
        branchMarkerId: String(event.branchMarkerId),
        sourceMessageId: String(event.sourceMessageId),
        label: String(event.label ?? ''),
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      }],
    });
    return nextMessages;
  }

  if (event.eventType === 'branch.separator.removed') {
    return nextMessages.filter((message) => message.messageId !== `separator:${String(event.branchMarkerId)}`);
  }

  const assistant = ensureAssistantMessage(nextMessages, event);
  const process = ensureProcessBlock(assistant, event);

  if (event.eventType === 'turn.completed') {
    process.status = 'completed';
    process.endedAt = event.createdAt;
  } else if (event.eventType === 'turn.failed') {
    process.status = 'failed';
    process.endedAt = event.createdAt;
    upsertProcessItem(process, {
      itemId: `error:${event.runId}`,
      kind: 'error_activity',
      errorCode: String(event.errorCode ?? ''),
      errorMessage: String(event.errorMessage ?? event.errorCode ?? 'Turn failed.'),
      recoverable: Boolean(event.recoverable),
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  } else if (event.eventType === 'turn.cancelled') {
    process.status = 'cancelled';
    process.endedAt = event.createdAt;
    upsertProcessItem(process, {
      itemId: `cancelled:${event.runId}`,
      kind: 'cancelled_activity',
      reason: typeof event.reason === 'string' ? event.reason : undefined,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  } else if (
    event.eventType === 'assistant.text.started'
    || event.eventType === 'assistant.text.delta'
    || event.eventType === 'assistant.text.reclassified'
    || event.eventType === 'assistant.text.completed'
    || event.eventType === 'assistant.text.failed'
    || event.eventType === 'assistant.text.cancelled_partial'
  ) {
    if (event.eventType === 'assistant.text.reclassified') {
      reclassifyAssistantTextBlock(assistant, process, event as ChatStreamEvent & {
        eventType: 'assistant.text.reclassified';
        textId: string;
        fromPhase: AssistantTextPhase;
        toPhase: AssistantTextPhase;
      });
    } else if (event.phase === 'prelude') {
      const item = ensurePreludeTextItem(process, String(event.textId), event.createdAt);
      if (event.eventType === 'assistant.text.delta') {
        item.text += String(event.delta ?? '');
      } else if (event.eventType === 'assistant.text.completed') {
        item.status = 'completed';
      } else if (event.eventType === 'assistant.text.failed') {
        item.status = 'failed';
      } else if (event.eventType === 'assistant.text.cancelled_partial') {
        item.status = 'cancelled_partial';
      }
      item.updatedAt = event.createdAt;
    } else {
      const answer = ensureAnswerBlock(assistant, event, String(event.textId));
      if (event.eventType === 'assistant.text.delta') {
        answer.text += String(event.delta ?? '');
      } else if (event.eventType === 'assistant.text.completed') {
        answer.status = 'completed';
      } else if (event.eventType === 'assistant.text.failed') {
        answer.status = 'failed';
      } else if (event.eventType === 'assistant.text.cancelled_partial') {
        answer.status = 'cancelled_partial';
      }
      answer.updatedAt = event.createdAt;
    }
  } else if (event.eventType === 'assistant.thinking.started' || event.eventType === 'assistant.thinking.delta') {
    const item = ensureThinkingItem(process, String(event.thinkingId), event.createdAt);
    if (event.eventType === 'assistant.thinking.delta') {
      item.text += String(event.delta ?? '');
    }
    item.updatedAt = event.createdAt;
  } else if (event.eventType === 'assistant.thinking.completed') {
    const item = ensureThinkingItem(process, String(event.thinkingId), event.createdAt);
    item.status = 'completed';
    item.updatedAt = event.createdAt;
  } else if (event.eventType === 'tool.started' || event.eventType === 'tool.completed' || event.eventType === 'tool.failed' || event.eventType === 'tool.denied') {
    upsertProcessItem(process, {
      itemId: `tool:${String(event.toolCallId)}`,
      kind: 'tool_activity',
      toolCallId: String(event.toolCallId),
      toolExecutionId: typeof event.toolExecutionId === 'string' ? event.toolExecutionId : undefined,
      toolResultId: typeof event.toolResultId === 'string' ? event.toolResultId : undefined,
      toolName: String(event.toolName),
      displayName: typeof event.displayName === 'string' ? event.displayName : undefined,
      inputSummary: typeof event.inputSummary === 'string' ? event.inputSummary : undefined,
      resultSummary: typeof event.resultSummary === 'string' ? event.resultSummary : undefined,
      status: event.eventType === 'tool.completed' ? 'succeeded' : event.eventType === 'tool.failed' ? 'failed' : event.eventType === 'tool.denied' ? 'denied' : 'running',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  } else if (event.eventType === 'approval.requested' || event.eventType === 'approval.resolved') {
    upsertProcessItem(process, {
      itemId: `approval:${String(event.approvalId)}`,
      kind: 'approval_activity',
      approvalId: String(event.approvalId),
      toolCallId: typeof event.toolCallId === 'string' ? event.toolCallId : undefined,
      toolExecutionId: typeof event.toolExecutionId === 'string' ? event.toolExecutionId : undefined,
      scope: String(event.scope ?? ''),
      status: String(event.status ?? 'pending') as ApprovalActivityItem['status'],
      title: String(event.title ?? event.approvalId),
      description: typeof event.description === 'string' ? event.description : undefined,
      subjectSummary: typeof event.subjectSummary === 'string' ? event.subjectSummary : undefined,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  } else if (
    event.eventType === 'process.compaction.recorded'
    || event.eventType === 'process.retry.recorded'
    || event.eventType === 'process.recovery.recorded'
  ) {
    upsertProcessFactItem(process, event);
  } else if (event.eventType === 'workspace.change.footer.updated') {
    assistant.workspaceChangeFooter = event.footer as WorkspaceChangeFooterFact;
  }

  process.updatedAt = event.createdAt;
  assistant.updatedAt = event.createdAt;
  return nextMessages;
}

function upsertProcessFactItem(
  process: ProcessDisclosureBlock,
  event: ChatStreamEvent,
): void {
  const item = processFactItem(event);
  if (!item) {
    return;
  }

  const existingIndex = process.items.findIndex((candidate) => candidate.itemId === item.itemId);
  if (existingIndex === -1) {
    process.items.push(item);
  } else {
    process.items[existingIndex] = item;
  }
}

function processFactItem(event: ChatStreamEvent): ProcessDisclosureItem | undefined {
  if (event.eventType === 'process.compaction.recorded') {
    return {
      itemId: `compaction:${String(event.compactionId ?? event.eventId)}`,
      kind: 'compaction_activity',
      compactionId: typeof event.compactionId === 'string' ? event.compactionId : undefined,
      status: isCompactionStatus(event.status) ? event.status : 'completed',
      label: typeof event.label === 'string' ? event.label : '已整理上下文',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }

  if (event.eventType === 'process.retry.recorded') {
    return {
      itemId: `retry:${String(event.retryAttemptId ?? event.eventId)}`,
      kind: 'retry_activity',
      retryAttemptId: String(event.retryAttemptId ?? event.eventId),
      attemptNumber: typeof event.attemptNumber === 'number' ? event.attemptNumber : 1,
      status: isRetryStatus(event.status) ? event.status : 'started',
      label: typeof event.label === 'string' ? event.label : '已记录重试',
      reason: typeof event.reason === 'string' ? event.reason : undefined,
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }

  if (event.eventType === 'process.recovery.recorded') {
    return {
      itemId: `recovery:${event.runId}:${String(event.status ?? event.eventId)}`,
      kind: 'recovery_activity',
      status: isRecoveryStatus(event.status) ? event.status : 'interrupted',
      label: typeof event.label === 'string' ? event.label : '已记录恢复状态',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    };
  }

  return undefined;
}

function isCompactionStatus(value: unknown): value is CompactionActivityItem['status'] {
  return value === 'completed' || value === 'skipped' || value === 'boundary_unresolved';
}

function isRetryStatus(value: unknown): value is RetryActivityItem['status'] {
  return value === 'started'
    || value === 'failed'
    || value === 'completed'
    || value === 'exhausted'
    || value === 'cancelled';
}

function isRecoveryStatus(value: unknown): value is RecoveryActivityItem['status'] {
  return value === 'interrupted'
    || value === 'manual_retry_requested'
    || value === 'manual_rerun_requested'
    || value === 'marked_cancelled';
}
