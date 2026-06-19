// Renderer-facing timeline message contracts and chat stream reducer.
import type { ChatStreamEvent } from './chat-stream';
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
  if (event.eventType === 'assistant.delta') {
    const text = typeof event.payload === 'object' && event.payload && 'text' in event.payload
      ? String(event.payload.text ?? '')
      : '';
    const messageId = `assistant:${event.runId}`;
    const existing = messages.find((message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.messageId === messageId
    );

    if (!existing) {
      return [...messages, {
        messageId,
        role: 'assistant',
        runId: event.runId,
        projectId: event.projectId,
        sessionId: event.sessionId,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        blocks: [{
          blockId: `answer:${event.runId}`,
          kind: 'answer_text',
          runId: event.runId,
          textId: `${event.runId}:answer`,
          status: 'streaming',
          text,
          format: 'markdown',
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        }],
      }];
    }
  }

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
  } else if (event.eventType === 'assistant.text.delta') {
    if (event.phase === 'prelude') {
      upsertProcessItem(process, {
        itemId: `prelude:${String(event.textId)}`,
        kind: 'assistant_text',
        textId: String(event.textId),
        phase: 'prelude',
        status: 'streaming',
        text: String(event.delta ?? ''),
        format: 'markdown',
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
    } else {
      const answer = ensureAnswerBlock(assistant, event, String(event.textId));
      answer.text += String(event.delta ?? '');
      answer.updatedAt = event.createdAt;
    }
  } else if (event.eventType === 'assistant.text.completed') {
    const answer = ensureAnswerBlock(assistant, event, String(event.textId));
    answer.status = 'completed';
    answer.updatedAt = event.createdAt;
  } else if (event.eventType === 'assistant.thinking.delta') {
    upsertProcessItem(process, {
      itemId: `thinking:${String(event.thinkingId)}`,
      kind: 'thinking',
      thinkingId: String(event.thinkingId),
      status: 'streaming',
      text: String(event.delta ?? ''),
      format: 'plain',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
  } else if (event.eventType === 'assistant.thinking.completed') {
    upsertProcessItem(process, {
      itemId: `thinking:${String(event.thinkingId)}`,
      kind: 'thinking',
      thinkingId: String(event.thinkingId),
      status: 'completed',
      text: '',
      format: 'plain',
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
    });
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
  } else if (event.eventType === 'workspace.change.footer.updated') {
    assistant.workspaceChangeFooter = event.footer as WorkspaceChangeFooterFact;
  }

  process.updatedAt = event.createdAt;
  assistant.updatedAt = event.createdAt;
  return nextMessages;
}
