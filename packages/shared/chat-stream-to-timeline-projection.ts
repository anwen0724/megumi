import type { ChatStreamEvent } from './chat-stream-events';
import type {
  AnswerTextBlock,
  ApprovalActivityItem,
  AssistantTextItem,
  AssistantTimelineBlock,
  BranchSeparatorBlock,
  CancelledActivityItem,
  ErrorActivityItem,
  ProcessDisclosureBlock,
  ProcessDisclosureItem,
  ThinkingItem,
  TimelineAssistantMessage,
  TimelineMessage,
  TimelineUserMessage,
  ToolActivityItem,
  UserTimelineBlock,
} from './timeline-message-blocks';

export function reduceChatStreamEvent(
  messages: TimelineMessage[],
  event: ChatStreamEvent,
): TimelineMessage[] {
  const nextMessages = cloneMessages(messages);

  switch (event.eventType) {
    case 'branch.separator.created': {
      upsertBranchSeparator(nextMessages, event);
      return nextMessages;
    }

    case 'turn.started': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      ensureProcessBlock(assistant, event).status = 'running';
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'user.message.committed': {
      upsertUserMessage(nextMessages, event);
      return nextMessages;
    }

    case 'assistant.thinking.started':
    case 'assistant.thinking.delta':
    case 'assistant.thinking.completed': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      const item = ensureThinkingItem(process, event.thinkingId, event.createdAt);

      if (event.eventType === 'assistant.thinking.delta') {
        item.text += event.delta;
      }

      if (event.eventType === 'assistant.thinking.completed') {
        item.status = 'completed';
      }

      item.updatedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'assistant.text.started':
    case 'assistant.text.delta':
    case 'assistant.text.completed':
    case 'assistant.text.failed':
    case 'assistant.text.cancelled_partial': {
      if (event.phase === 'prelude') {
        const assistant = ensureAssistantMessage(nextMessages, event);
        const process = ensureProcessBlock(assistant, event);
        const item = ensurePreludeItem(process, event.textId, event.createdAt);

        if (event.eventType === 'assistant.text.delta') {
          item.text += event.delta;
        } else if (event.eventType === 'assistant.text.completed') {
          item.status = 'completed';
        } else if (event.eventType === 'assistant.text.failed') {
          item.status = 'failed';
        } else if (event.eventType === 'assistant.text.cancelled_partial') {
          item.status = 'cancelled_partial';
        }

        item.updatedAt = event.createdAt;
        process.updatedAt = event.createdAt;
        assistant.updatedAt = event.createdAt;
        return nextMessages;
      }

      const assistant = ensureAssistantMessage(nextMessages, event);
      const answer = ensureAnswerBlock(assistant, event.textId, event);

      if (event.eventType === 'assistant.text.delta') {
        answer.text += event.delta;
      } else if (event.eventType === 'assistant.text.completed') {
        answer.status = 'completed';
      } else if (event.eventType === 'assistant.text.failed') {
        answer.status = 'failed';
      } else if (event.eventType === 'assistant.text.cancelled_partial') {
        answer.status = 'cancelled_partial';
      }

      answer.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed':
    case 'tool.denied': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      const item = ensureToolItem(process, event);

      item.toolCallId = event.toolCallId;
      item.toolExecutionId = event.toolExecutionId;
      item.toolName = event.toolName;
      item.displayName = event.displayName;
      item.inputSummary = event.inputSummary;

      if (event.eventType === 'tool.completed') {
        item.toolResultId = event.toolResultId;
        item.resultSummary = event.resultSummary;
        item.status = 'succeeded';
      } else if (event.eventType === 'tool.failed') {
        item.toolResultId = event.toolResultId;
        item.resultSummary = event.resultSummary;
        item.status = 'failed';
      } else if (event.eventType === 'tool.denied') {
        item.toolResultId = event.toolResultId;
        item.status = 'denied';
      } else {
        item.status = 'running';
      }

      item.updatedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'approval.requested':
    case 'approval.resolved': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      const item = ensureApprovalItem(process, event);

      item.toolCallId = event.toolCallId;
      item.toolExecutionId = event.toolExecutionId;
      item.scope = event.scope;
      item.status = event.status;

      if (event.eventType === 'approval.requested') {
        item.title = event.title;
        item.description = event.description;
        item.subjectSummary = event.subjectSummary;
      }

      item.updatedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'process.compaction.recorded':
    case 'process.retry.recorded':
    case 'process.recovery.recorded': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      upsertProcessFactItem(process, event);
      process.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'turn.completed': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      process.status = 'completed';
      process.endedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'turn.failed': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      const item = ensureErrorItem(process, event);
      process.status = 'failed';
      process.endedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      item.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }

    case 'turn.cancelled': {
      const assistant = ensureAssistantMessage(nextMessages, event);
      const process = ensureProcessBlock(assistant, event);
      const item = ensureCancelledItem(process, event);
      process.status = 'cancelled';
      process.endedAt = event.createdAt;
      process.updatedAt = event.createdAt;
      item.updatedAt = event.createdAt;
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }
  }
}

function cloneMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      return {
        ...message,
        blocks: message.blocks.map((block) => ({ ...block })) as UserTimelineBlock[],
      };
    }

    if (message.role === 'separator') {
      return {
        ...message,
        blocks: message.blocks.map((block) => ({ ...block })) as [BranchSeparatorBlock],
      };
    }

    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.kind === 'process_disclosure') {
          return {
            ...block,
            items: block.items.map((item) => ({ ...item })) as ProcessDisclosureItem[],
          };
        }

        return { ...block };
      }) as AssistantTimelineBlock[],
    };
  });
}

function upsertBranchSeparator(
  messages: TimelineMessage[],
  event: Extract<ChatStreamEvent, { eventType: 'branch.separator.created' }>,
): void {
  const messageId = `separator:${event.branchMarkerId}`;
  const block = {
    blockId: `branch-separator:${event.branchMarkerId}`,
    kind: 'branch_separator' as const,
    branchMarkerId: event.branchMarkerId,
    sourceMessageId: event.sourceMessageId,
    label: event.label,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  const existing = messages.find(
    (message) => message.role === 'separator' && message.messageId === messageId,
  );

  if (existing) {
    existing.blocks = [block];
    existing.updatedAt = event.createdAt;
    return;
  }

  messages.push({
    messageId,
    role: 'separator',
    projectId: event.projectId,
    sessionId: event.sessionId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    blocks: [block],
  });
}

function ensureAssistantMessage(
  messages: TimelineMessage[],
  event: ChatStreamEvent,
): TimelineAssistantMessage {
  const messageId = `assistant:${event.runId}`;
  const existing = messages.find(
    (message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.messageId === messageId,
  );

  if (existing) {
    return existing;
  }

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

function upsertUserMessage(
  messages: TimelineMessage[],
  event: Extract<ChatStreamEvent, { eventType: 'user.message.committed' }>,
): void {
  const existing = messages.find(
    (message): message is TimelineUserMessage =>
      message.role === 'user' &&
      (message.messageId === event.messageId || message.messageId === event.clientMessageId),
  );
  const block = {
    blockId: `user-text:${event.messageId}`,
    kind: 'user_text' as const,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    text: event.text,
    format: 'plain' as const,
  };

  if (existing) {
    existing.messageId = event.messageId;
    existing.runId = event.runId;
    existing.turnOrder = 0;
    existing.clientMessageId = event.clientMessageId;
    existing.projectId = event.projectId;
    existing.sessionId = event.sessionId;
    const blockIndex = existing.blocks.findIndex((candidate) => candidate.kind === 'user_text');
    if (blockIndex === -1) {
      existing.blocks.push(block);
    } else {
      existing.blocks[blockIndex] = {
        ...existing.blocks[blockIndex],
        ...block,
      };
    }
    existing.updatedAt = event.createdAt;
    moveUserBeforeAssistant(messages, existing, event.runId);
    return;
  }

  const userMessage: TimelineUserMessage = {
    messageId: event.messageId,
    role: 'user',
    projectId: event.projectId,
    sessionId: event.sessionId,
    runId: event.runId,
    turnOrder: 0,
    clientMessageId: event.clientMessageId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    blocks: [block],
  };
  const assistantIndex = messages.findIndex(
    (message) => message.role === 'assistant' && message.messageId === `assistant:${event.runId}`,
  );
  messages.splice(assistantIndex === -1 ? messages.length : assistantIndex, 0, userMessage);
}

function moveUserBeforeAssistant(
  messages: TimelineMessage[],
  userMessage: TimelineUserMessage,
  runId: string,
): void {
  const userIndex = messages.findIndex((message) => message === userMessage);
  const assistantIndex = messages.findIndex(
    (message) => message.role === 'assistant' && message.messageId === `assistant:${runId}`,
  );

  if (userIndex === -1 || assistantIndex === -1 || userIndex < assistantIndex) {
    return;
  }

  messages.splice(userIndex, 1);
  messages.splice(assistantIndex, 0, userMessage);
}

function ensureProcessBlock(
  assistant: TimelineAssistantMessage,
  event: ChatStreamEvent,
): ProcessDisclosureBlock {
  const blockId = `process:${event.runId}`;
  const existing = assistant.blocks.find(
    (block): block is ProcessDisclosureBlock =>
      block.kind === 'process_disclosure' && block.blockId === blockId,
  );

  if (existing) {
    return existing;
  }

  const process: ProcessDisclosureBlock = {
    blockId,
    kind: 'process_disclosure',
    runId: event.runId,
    status: 'running',
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    startedAt: event.createdAt,
    items: [],
  };
  assistant.blocks.unshift(process);
  return process;
}

function ensureAnswerBlock(
  assistant: TimelineAssistantMessage,
  textId: string,
  event: ChatStreamEvent,
): AnswerTextBlock {
  const blockId = `answer:${event.runId}`;
  const existing = assistant.blocks.find(
    (block): block is AnswerTextBlock => block.kind === 'answer_text' && block.blockId === blockId,
  );

  if (existing) {
    return existing;
  }

  const answer: AnswerTextBlock = {
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
  const processIndex = assistant.blocks.findIndex((block) => block.kind === 'process_disclosure');
  assistant.blocks.splice(processIndex === -1 ? assistant.blocks.length : processIndex + 1, 0, answer);
  return answer;
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

  if (existing) {
    return existing;
  }

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

function ensurePreludeItem(
  process: ProcessDisclosureBlock,
  textId: string,
  createdAt: string,
): AssistantTextItem {
  const itemId = `prelude:${textId}`;
  const existing = process.items.find(
    (item): item is AssistantTextItem => item.kind === 'assistant_text' && item.itemId === itemId,
  );

  if (existing) {
    return existing;
  }

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

function ensureToolItem(
  process: ProcessDisclosureBlock,
  event: Extract<
    ChatStreamEvent,
    { eventType: 'tool.started' | 'tool.completed' | 'tool.failed' | 'tool.denied' }
  >,
): ToolActivityItem {
  const itemId = `tool:${event.toolCallId}`;
  const existing = process.items.find(
    (item): item is ToolActivityItem => item.kind === 'tool_activity' && item.itemId === itemId,
  );

  if (existing) {
    return existing;
  }

  const item: ToolActivityItem = {
    itemId,
    kind: 'tool_activity',
    toolCallId: event.toolCallId,
    toolExecutionId: event.toolExecutionId,
    toolName: event.toolName,
    displayName: event.displayName,
    inputSummary: event.inputSummary,
    status: 'running',
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureApprovalItem(
  process: ProcessDisclosureBlock,
  event: Extract<ChatStreamEvent, { eventType: 'approval.requested' | 'approval.resolved' }>,
): ApprovalActivityItem {
  const itemId = `approval:${event.approvalId}`;
  const existing = process.items.find(
    (item): item is ApprovalActivityItem =>
      item.kind === 'approval_activity' && item.itemId === itemId,
  );

  if (existing) {
    return existing;
  }

  const item: ApprovalActivityItem = {
    itemId,
    kind: 'approval_activity',
    approvalId: event.approvalId,
    toolCallId: event.toolCallId,
    toolExecutionId: event.toolExecutionId,
    scope: event.scope,
    status: event.status,
    title: event.eventType === 'approval.requested' ? event.title : event.approvalId,
    description: event.eventType === 'approval.requested' ? event.description : undefined,
    subjectSummary: event.eventType === 'approval.requested' ? event.subjectSummary : undefined,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureErrorItem(
  process: ProcessDisclosureBlock,
  event: Extract<ChatStreamEvent, { eventType: 'turn.failed' }>,
): ErrorActivityItem {
  const itemId = `error:${event.runId}`;
  const existing = process.items.find(
    (item): item is ErrorActivityItem => item.kind === 'error_activity' && item.itemId === itemId,
  );

  if (existing) {
    existing.errorCode = event.errorCode;
    existing.errorMessage = event.errorMessage ?? event.errorCode ?? 'Turn failed.';
    existing.recoverable = event.recoverable;
    return existing;
  }

  const item: ErrorActivityItem = {
    itemId,
    kind: 'error_activity',
    errorCode: event.errorCode,
    errorMessage: event.errorMessage ?? event.errorCode ?? 'Turn failed.',
    recoverable: event.recoverable,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureCancelledItem(
  process: ProcessDisclosureBlock,
  event: Extract<ChatStreamEvent, { eventType: 'turn.cancelled' }>,
): CancelledActivityItem {
  const itemId = `cancelled:${event.runId}`;
  const existing = process.items.find(
    (item): item is CancelledActivityItem =>
      item.kind === 'cancelled_activity' && item.itemId === itemId,
  );

  if (existing) {
    existing.reason = event.reason;
    return existing;
  }

  const item: CancelledActivityItem = {
    itemId,
    kind: 'cancelled_activity',
    reason: event.reason,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  return item;
}

function upsertProcessFactItem(
  process: ProcessDisclosureBlock,
  event: Extract<
    ChatStreamEvent,
    {
      eventType:
        | 'process.compaction.recorded'
        | 'process.retry.recorded'
        | 'process.recovery.recorded';
    }
  >,
): void {
  const item =
    event.eventType === 'process.compaction.recorded'
      ? {
          itemId: `compaction:${event.compactionId ?? event.eventId}`,
          kind: 'compaction_activity' as const,
          compactionId: event.compactionId,
          status: event.status,
          label: event.label,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        }
      : event.eventType === 'process.retry.recorded'
        ? {
            itemId: `retry:${event.retryAttemptId}`,
            kind: 'retry_activity' as const,
            retryAttemptId: event.retryAttemptId,
            attemptNumber: event.attemptNumber,
            status: event.status,
            label: event.label,
            reason: event.reason,
            createdAt: event.createdAt,
            updatedAt: event.createdAt,
          }
        : {
            itemId: `recovery:${event.runId}:${event.status}`,
            kind: 'recovery_activity' as const,
            status: event.status,
            label: event.label,
            createdAt: event.createdAt,
            updatedAt: event.createdAt,
          };

  const existingIndex = process.items.findIndex((candidate) => candidate.itemId === item.itemId);
  if (existingIndex === -1) {
    process.items.push(item);
  } else {
    process.items[existingIndex] = item;
  }
}
