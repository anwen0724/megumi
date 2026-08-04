/* Reduces live Runtime Events into a host-neutral Timeline read model. */
import type { AnyEvent } from '@megumi/events';
import type {
  AnswerTextBlock,
  CancelledActivityItem,
  CompactionActivityItem,
  ErrorActivityItem,
  PlanActivityItem,
  ProcessDisclosureBlock,
  RetryActivityItem,
  ThinkingItem,
  TimelineAssistantMessage,
  TimelineMessage,
  ToolActivityItem,
} from './timeline-message';
import { summarizeToolTarget } from './tool-activity';

export interface RuntimeTimeline {
  readonly messages: TimelineMessage[];
  readonly appliedEventIds: Readonly<Record<string, true>>;
}

export interface CreateRuntimeTimelineRequest {
  readonly messages?: TimelineMessage[];
}

export interface ReduceRuntimeTimelineRequest {
  readonly timeline: RuntimeTimeline;
  readonly event: AnyEvent;
}

export function createRuntimeTimeline(
  request: CreateRuntimeTimelineRequest = {},
): RuntimeTimeline {
  return {
    messages: cloneMessages(request.messages ?? []),
    appliedEventIds: {},
  };
}

export function reduceRuntimeTimeline(
  request: ReduceRuntimeTimelineRequest,
): RuntimeTimeline {
  if (request.timeline.appliedEventIds[request.event.id]) {
    return request.timeline;
  }

  return {
    messages: projectRuntimeTimelineEvent(request.timeline.messages, request.event),
    appliedEventIds: {
      ...request.timeline.appliedEventIds,
      [request.event.id]: true,
    },
  };
}

function projectRuntimeTimelineEvent(
  messages: TimelineMessage[],
  event: AnyEvent,
): TimelineMessage[] {
  const nextMessages = cloneMessages(messages);

  if (!event.runId || !event.sessionId) {
    return nextMessages;
  }

  if (event.type === 'run.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    ensureProcessBlock(assistant, event).status = 'running';
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'turn.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    ensureProcessBlock(assistant, event).status = 'running';
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'message.update') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    if (hasCompletedAnswerBlock(assistant)) {
      assistant.updatedAt = event.createdAt;
      return nextMessages;
    }
    // Full snapshot: replace, never merge.
    const answer = ensureAnswerBlock(assistant, event, payload.messageId);
    answer.text = payload.content;
    answer.status = 'streaming';
    answer.updatedAt = event.createdAt;
    assistant.messageId = payload.messageId;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'message.thinking.update') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    // Full snapshot: replace, never merge.
    const item = ensureThinkingItem(process, payload.messageId, event.createdAt);
    item.text = payload.thinking;
    item.status = 'streaming';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'message.ended' && event.payload.role === 'assistant') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    assistant.messageId = event.payload.messageId;
    const answer = assistant.blocks.find(
      (block): block is AnswerTextBlock => block.kind === 'answer_text',
    );
    if (answer && answer.status !== 'completed') {
      answer.text = event.payload.content;
      answer.status = 'completed';
      answer.updatedAt = event.createdAt;
    }
    // The settled message closes any streaming thinking item too.
    for (const block of assistant.blocks) {
      if (block.kind !== 'process_disclosure') continue;
      for (const item of block.items) {
        if (item.kind === 'thinking' && item.status !== 'completed') {
          item.status = 'completed';
          item.updatedAt = event.createdAt;
        }
      }
    }
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'message.ended' && event.payload.role === 'tool_result') {
    // The transcript records the tool output; the activity item was settled by
    // tool_execution.ended, so only keep the assistant message fresh.
    const assistant = ensureAssistantMessage(nextMessages, event);
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'turn.ended') {
    // The turn's tool calls are now known: surface them as requested items.
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    for (const toolCallId of event.payload.toolCallIds) {
      const item = ensureToolItem(process, toolCallId, event.createdAt);
      item.status = 'requested';
      item.updatedAt = event.createdAt;
    }
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'tool_execution.requested') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId, event.createdAt);
    item.toolName = payload.toolName;
    item.inputSummary = summarizeToolTarget(payload.toolName, payload.args);
    item.status = 'requested';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'tool_execution.started') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId, event.createdAt);
    item.toolName = payload.toolName;
    item.inputSummary = summarizeToolTarget(payload.toolName, payload.args);
    item.status = 'running';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'tool_execution.update') {
    // Streaming output is transient; refresh timestamps only.
    const assistant = ensureAssistantMessage(nextMessages, event);
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'tool_execution.ended') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId, event.createdAt);
    item.status = payload.status === 'completed'
      ? 'succeeded'
      : payload.status === 'cancelled'
        ? 'cancelled'
        : payload.status === 'denied'
          ? 'denied'
          : 'failed';
    if (payload.status === 'completed') {
      // Show the human-readable summary; the raw result payload (which may be
      // structured data) is never displayed.
      item.resultSummary = payload.summary;
    } else {
      delete item.resultSummary;
    }
    item.error = payload.error?.code && payload.error.message
      ? { code: payload.error.code, message: payload.error.message }
      : undefined;
    item.approval = undefined;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'approval.requested') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId, event.createdAt);
    item.toolName = payload.toolName;
    item.status = 'awaiting_approval';
    item.approval = {
      // The engine identity, not the event id: resolving the approval later
      // looks it up by this value.
      approvalRequestId: payload.approvalRequestId,
      defaultOptionId: payload.defaultOptionId,
      summary: payload.reason,
      options: payload.options.map((option) => ({
        optionId: option.optionId,
        scope: option.scope,
        label: option.label,
        description: option.description ?? '',
      })),
    };
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'approval.resolved') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId, event.createdAt);
    item.status = payload.decision === 'approved' ? 'queued' : 'denied';
    item.approval = undefined;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'turn.retry.started' || event.type === 'turn.retry.completed' || event.type === 'turn.retry.failed') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureRetryItem(process, payload.attemptNumber, event.createdAt);
    item.status = event.type === 'turn.retry.completed'
      ? 'completed'
      : event.type === 'turn.retry.failed'
        ? 'failed'
        : 'started';
    item.label = retryLabel(event.type, payload.attemptNumber);
    item.reason = event.type === 'turn.retry.failed'
      ? (event.payload as { error?: { message?: string } }).error?.message
      : undefined;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'tool_execution.plan_updated') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    // The plan replaces the tool activity for the same tool call.
    process.items = process.items.filter((item) => (
      !(item.kind === 'tool_activity' && item.toolCallId === payload.toolCallId)
    ));
    const item = ensurePlanActivityItem(process, event.runId ?? event.id, payload.toolCallId, event.createdAt);
    item.explanation = payload.explanation;
    item.plan = payload.plan.map((step) => ({ ...step }));
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'session.compaction.started' || event.type === 'session.compaction.ended') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureCompactionItem(
      process,
      event.type === 'session.compaction.ended' ? event.payload.compactionId : `compaction:${event.id}`,
      event.createdAt,
    );
    item.status = event.type === 'session.compaction.ended'
      ? event.payload.status === 'completed' ? 'completed' : 'failed'
      : 'running';
    item.label = event.type === 'session.compaction.ended'
      ? event.payload.status === 'completed' ? '已完成压缩' : `上下文压缩失败：${event.payload.error?.message ?? ''}`
      : '正在压缩上下文';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.type === 'run.ended') {
    const payload = event.payload;
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    if (payload.status === 'failed') {
      process.items.push({
        itemId: `error:${event.id}`,
        kind: 'error_activity',
        errorCode: payload.error?.code,
        errorMessage: payload.error?.message ?? 'Run failed.',
        recoverable: false,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
      const existingAnswer = assistant.blocks.find(
        (block): block is AnswerTextBlock => block.kind === 'answer_text',
      );
      const answer = existingAnswer ?? ensureAnswerBlock(assistant, event, event.runId);
      answer.status = 'failed';
      answer.updatedAt = event.createdAt;
      process.status = 'failed';
    } else if (payload.status === 'cancelled') {
      process.items.push({
        itemId: `cancelled:${event.id}`,
        kind: 'cancelled_activity',
        reason: 'user_cancelled',
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      });
      const existingAnswer = assistant.blocks.find(
        (block): block is AnswerTextBlock => block.kind === 'answer_text',
      );
      const answer = existingAnswer ?? ensureAnswerBlock(assistant, event, event.runId);
      answer.status = 'cancelled';
      answer.updatedAt = event.createdAt;
      process.status = 'cancelled';
    } else {
      process.status = 'completed';
    }
    process.endedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  return nextMessages;
}

function cloneMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return JSON.parse(JSON.stringify(messages)) as TimelineMessage[];
}

function ensureAssistantMessage(messages: TimelineMessage[], event: AnyEvent): TimelineAssistantMessage {
  const existing = messages.find(
    (message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === event.runId,
  );
  if (existing) return existing;

  const assistant: TimelineAssistantMessage = {
    messageId: `assistant:${event.runId}`,
    role: 'assistant',
    projectId: 'runtime',
    sessionId: event.sessionId ?? 'session:unknown',
    runId: event.runId ?? event.id,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    turnOrder: 1,
    blocks: [],
  };
  messages.push(assistant);
  return assistant;
}

function ensureProcessBlock(assistant: TimelineAssistantMessage, event: AnyEvent): ProcessDisclosureBlock {
  const existing = assistant.blocks.find((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure');
  if (existing) return existing;
  const block: ProcessDisclosureBlock = {
    blockId: `process:${event.runId}`,
    kind: 'process_disclosure',
    runId: event.runId ?? event.id,
    status: 'running',
    startedAt: event.createdAt,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    items: [],
  };
  assistant.blocks.unshift(block);
  return block;
}

function ensureAnswerBlock(
  assistant: TimelineAssistantMessage,
  event: AnyEvent,
  textId: string,
): AnswerTextBlock {
  const existing = findAnswerBlock(assistant, textId);
  if (existing) return existing;
  const block: AnswerTextBlock = {
    blockId: `answer:${event.runId}`,
    kind: 'answer_text',
    runId: event.runId ?? event.id,
    textId: `text:${textId}`,
    status: 'streaming',
    text: '',
    format: 'markdown',
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
  assistant.blocks.push(block);
  return block;
}

function findAnswerBlock(assistant: TimelineAssistantMessage, textId: string): AnswerTextBlock | undefined {
  return assistant.blocks.find(
    (block): block is AnswerTextBlock =>
      block.kind === 'answer_text' && (block.textId === `text:${textId}` || block.runId === textId),
  );
}

function hasCompletedAnswerBlock(assistant: TimelineAssistantMessage): boolean {
  return assistant.blocks.some(
    (block) => block.kind === 'answer_text' && block.status === 'completed',
  );
}

function ensureThinkingItem(process: ProcessDisclosureBlock, thinkingId: string, createdAt: string): ThinkingItem {
  const existing = process.items.find(
    (item): item is ThinkingItem => item.kind === 'thinking' && item.thinkingId === thinkingId,
  );
  if (existing) return existing;
  const item: ThinkingItem = {
    itemId: `thinking:${thinkingId}`,
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

function ensureRetryItem(process: ProcessDisclosureBlock, attemptNumber: number, createdAt: string): RetryActivityItem {
  const retryAttemptId = `retry:${attemptNumber}`;
  const existing = process.items.find(
    (item): item is RetryActivityItem => item.kind === 'retry_activity' && item.retryAttemptId === retryAttemptId,
  );
  if (existing) return existing;
  const item: RetryActivityItem = {
    itemId: retryAttemptId,
    kind: 'retry_activity',
    retryAttemptId,
    attemptNumber,
    status: 'started',
    label: retryLabel('turn.retry.started', attemptNumber),
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function retryLabel(eventType: 'turn.retry.started' | 'turn.retry.completed' | 'turn.retry.failed', attemptNumber: number): string {
  if (eventType === 'turn.retry.completed') return `Model call retry ${attemptNumber} completed`;
  if (eventType === 'turn.retry.failed') return `Model call retry ${attemptNumber} failed`;
  return `Model call retry ${attemptNumber} started`;
}

function ensurePlanActivityItem(
  process: ProcessDisclosureBlock,
  runId: string,
  toolCallId: string,
  createdAt: string,
): PlanActivityItem {
  const existing = process.items.find(
    (item): item is PlanActivityItem => item.kind === 'plan_activity',
  );
  if (existing) {
    existing.toolCallId = toolCallId;
    return existing;
  }
  const item: PlanActivityItem = {
    itemId: `plan:${runId}`,
    kind: 'plan_activity',
    toolCallId,
    plan: [],
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureToolItem(process: ProcessDisclosureBlock, toolCallId: string, createdAt: string): ToolActivityItem {
  const existing = process.items.find(
    (item): item is ToolActivityItem => item.kind === 'tool_activity' && item.toolCallId === toolCallId,
  );
  if (existing) return existing;
  const item: ToolActivityItem = {
    itemId: `tool:${toolCallId}`,
    kind: 'tool_activity',
    toolCallId,
    toolName: 'unknown_tool',
    status: 'requested',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function ensureCompactionItem(process: ProcessDisclosureBlock, compactionId: string, createdAt: string): CompactionActivityItem {
  const existing = process.items.find(
    (item): item is CompactionActivityItem => item.kind === 'compaction_activity' && item.compactionId === compactionId,
  );
  if (existing) return existing;
  const item: CompactionActivityItem = {
    itemId: `compaction:${compactionId}`,
    kind: 'compaction_activity',
    compactionId,
    status: 'running',
    label: '正在压缩上下文',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}
