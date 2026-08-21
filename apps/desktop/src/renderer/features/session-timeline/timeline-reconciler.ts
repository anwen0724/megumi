/*
 * Reconciles committed Session facts with optimistic and live Timeline state.
 * The rules are pure so synchronization order and UI storage remain separate.
 */
import type {
  AnswerTextBlock,
  ProcessDisclosureBlock,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
} from './timeline-model';

export interface PendingUserMessageInput {
  readonly projectId: string;
  readonly sessionId: string;
  readonly clientMessageId: string;
  readonly messageId?: string;
  readonly text: string;
  readonly attachments?: readonly {
    readonly draftAttachmentId: string;
    readonly type: 'image' | 'file';
    readonly name: string;
    readonly declaredMimeType?: string;
  }[];
  readonly createdAt: string;
  readonly executionId?: string;
}

export interface ReconcileTimelineOptions {
  readonly activeExecutionIds?: ReadonlySet<string>;
  readonly preserveRuntimeOnly?: boolean;
}

/** Sorts persisted and runtime messages by stable Session order and identity. */
export function compareTimelineMessages(left: TimelineMessage, right: TimelineMessage): number {
  if (left.historyOrder !== undefined && right.historyOrder === undefined) return -1;
  if (left.historyOrder === undefined && right.historyOrder !== undefined) return 1;
  if (left.historyOrder !== undefined && right.historyOrder !== undefined) {
    const historyOrder = left.historyOrder - right.historyOrder;
    if (historyOrder !== 0) return historyOrder;
  }

  const createdOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdOrder !== 0) return createdOrder;

  const runOrder = messageExecutionId(left).localeCompare(messageExecutionId(right));
  if (runOrder !== 0) return runOrder;

  const turnOrder = messageTurnOrder(left) - messageTurnOrder(right);
  if (turnOrder !== 0) return turnOrder;

  return String(left.messageId).localeCompare(String(right.messageId));
}

/**
 * Inserts an optimistic user message or replaces it with the committed identity
 * returned by Product without duplicating the visible turn.
 */
export function upsertPendingUserMessage(
  current: readonly TimelineMessage[],
  input: PendingUserMessageInput,
): TimelineMessage[] {
  const existing = current.find(
    (message): message is TimelineUserMessage =>
      message.role === 'user'
      && (
        message.messageId === input.clientMessageId
        || message.clientMessageId === input.clientMessageId
        || (Boolean(input.executionId) && message.executionId === input.executionId)
      ),
  );
  const nextBlocks: TimelineUserMessage['blocks'] = [
    ...(input.text ? [{
      blockId: `user-text:${input.clientMessageId}`,
      kind: 'user_text' as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      text: input.text,
      format: 'plain' as const,
    }] : []),
    ...(input.attachments ?? []).map((attachment) => ({
      blockId: `user-attachment:${attachment.draftAttachmentId}`,
      kind: 'user_attachment' as const,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      attachmentId: attachment.draftAttachmentId,
      attachmentType: attachment.type,
      name: attachment.name,
      ...(attachment.declaredMimeType ? { mediaType: attachment.declaredMimeType } : {}),
      source: 'local_file' as const,
    })),
  ];

  if (existing) {
    return current.map((message) => message === existing
      ? {
          ...existing,
          messageId: input.messageId ?? existing.messageId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          clientMessageId: input.clientMessageId,
          ...(input.executionId ? { executionId: input.executionId } : {}),
          updatedAt: input.createdAt,
          blocks: nextBlocks,
        }
      : message);
  }

  const pending: TimelineUserMessage = {
    messageId: input.messageId ?? input.clientMessageId,
    role: 'user',
    projectId: input.projectId,
    sessionId: input.sessionId,
    turnOrder: 0,
    clientMessageId: input.clientMessageId,
    ...(input.executionId ? { executionId: input.executionId } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    blocks: nextBlocks,
  };
  return [...current, pending].sort(compareTimelineMessages);
}

/**
 * Reconciles persisted history with current presentation state. Committed
 * answers win, while runtime disclosure and active optimistic work survive.
 */
export function reconcileTimelineMessages(
  current: readonly TimelineMessage[],
  committed: readonly TimelineMessage[],
  options: ReconcileTimelineOptions = {},
): TimelineMessage[] {
  const byIdentity = new Map<string, TimelineMessage>();
  for (const message of committed) {
    byIdentity.set(messageIdentity(message), message);
  }

  for (const message of current) {
    const identity = messageIdentity(message);
    const committedMessage = byIdentity.get(identity);
    if (committedMessage?.role === 'assistant' && message.role === 'assistant') {
      byIdentity.set(identity, mergeAssistantMessage(committedMessage, message));
      continue;
    }

    if (committedMessage) continue;

    if (
      options.preserveRuntimeOnly
      || isLivePresentationMessage(message)
      || isOptimisticUserMessage(message)
      || options.activeExecutionIds?.has(messageExecutionId(message))
    ) {
      byIdentity.set(identity, message);
    }
  }

  return [...byIdentity.values()].sort(compareTimelineMessages);
}

function isOptimisticUserMessage(message: TimelineMessage): boolean {
  return message.role === 'user'
    && Boolean(message.clientMessageId)
    && (!message.executionId || message.messageId === message.clientMessageId);
}

/** Reconciles only one terminal Run without disturbing other Session UI state. */
export function reconcileCommittedRunMessages(
  current: readonly TimelineMessage[],
  executionId: string,
  committed: readonly TimelineMessage[],
): TimelineMessage[] {
  const currentRun = current.filter((message) => messageExecutionId(message) === executionId);
  const committedRun = committed.filter((message) => messageExecutionId(message) === executionId);
  if (committedRun.length === 0) return [...current];

  const completeCommittedRun = [...committedRun];
  if (!completeCommittedRun.some((message) => message.role === 'user')) {
    completeCommittedRun.unshift(...currentRun.filter((message) => message.role === 'user'));
  }
  if (!completeCommittedRun.some((message) => message.role === 'assistant')) {
    completeCommittedRun.push(...currentRun.filter((message) => message.role === 'assistant'));
  }

  return [
    ...current.filter((message) => messageExecutionId(message) !== executionId),
    ...reconcileTimelineMessages(currentRun, completeCommittedRun),
  ].sort(compareTimelineMessages);
}

function mergeAssistantMessage(
  committed: TimelineAssistantMessage,
  runtime: TimelineAssistantMessage,
): TimelineAssistantMessage {
  const processBlocks = new Map<string, ProcessDisclosureBlock>();
  for (const block of assistantProcessBlocks(committed)) processBlocks.set(block.blockId, block);
  for (const runtimeBlock of assistantProcessBlocks(runtime)) {
    const committedBlock = processBlocks.get(runtimeBlock.blockId);
    processBlocks.set(
      runtimeBlock.blockId,
      committedBlock ? mergeProcessBlock(committedBlock, runtimeBlock) : runtimeBlock,
    );
  }

  const committedAnswers = assistantAnswerBlocks(committed);
  const runtimeAnswers = assistantAnswerBlocks(runtime);
  const updatedAt = [committed.updatedAt, runtime.updatedAt].filter(Boolean).sort().at(-1);
  return {
    ...committed,
    ...(updatedAt ? { updatedAt } : {}),
    workspaceChangeFooter: committed.workspaceChangeFooter ?? runtime.workspaceChangeFooter,
    blocks: [
      ...processBlocks.values(),
      ...(committedAnswers.length > 0 ? committedAnswers : runtimeAnswers),
    ],
  };
}

/** Keeps durable process facts authoritative while retaining runtime-only diagnostics. */
function mergeProcessBlock(
  committed: ProcessDisclosureBlock,
  runtime: ProcessDisclosureBlock,
): ProcessDisclosureBlock {
  const runtimeItems = new Map(runtime.items.map((item) => [item.itemId, item]));
  const committedItems = committed.items.map((item) => ({
    ...runtimeItems.get(item.itemId),
    ...item,
  }));
  const committedItemIds = new Set(committed.items.map((item) => item.itemId));
  return {
    ...runtime,
    ...committed,
    items: [
      ...committedItems,
      ...runtime.items.filter((item) => !committedItemIds.has(item.itemId)),
    ],
  };
}

function isLivePresentationMessage(message: TimelineMessage): boolean {
  if (message.role !== 'assistant') return false;
  return message.blocks.some((block) => {
    if (block.kind === 'answer_text') return block.status === 'streaming';
    if (block.status === 'running') return true;
    return block.items.some((item) =>
      'status' in item
      && (item.status === 'running' || item.status === 'streaming'));
  });
}

function assistantProcessBlocks(message: TimelineAssistantMessage): ProcessDisclosureBlock[] {
  return message.blocks.filter(
    (block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure',
  );
}

function assistantAnswerBlocks(message: TimelineAssistantMessage): AnswerTextBlock[] {
  return message.blocks.filter((block): block is AnswerTextBlock => block.kind === 'answer_text');
}

function messageIdentity(message: TimelineMessage): string {
  if (message.role === 'assistant') return `assistant:${message.executionId}`;
  if (message.role === 'separator') return `separator:${message.messageId}`;
  if (message.role === 'activity') return `activity:${message.messageId}`;
  if (message.executionId) return `user-run:${message.sessionId}:${message.executionId}`;
  return `user:${message.clientMessageId ?? message.messageId}`;
}

function messageExecutionId(message: TimelineMessage): string {
  return message.role === 'assistant' || message.role === 'user' ? String(message.executionId ?? '') : '';
}

function messageTurnOrder(message: TimelineMessage): number {
  if (message.turnOrder !== undefined) return message.turnOrder;
  if (message.role === 'user') return 0;
  if (message.role === 'assistant') return 1;
  return 2;
}
