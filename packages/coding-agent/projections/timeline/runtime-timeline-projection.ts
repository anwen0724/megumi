import type { RuntimeEvent } from '../../events';
import type {
  AnswerTextBlock,
  AssistantTextItem,
  ProcessDisclosureBlock,
  TimelineAssistantMessage,
  TimelineMessage,
  ToolActivityItem,
} from './timeline-message-blocks';

/*
 * Projects backend RuntimeEvent envelopes into the chat timeline model.
 * The renderer consumes this directly; no secondary event compatibility layer is involved.
 */
export function reduceRuntimeTimelineEvent(
  messages: TimelineMessage[],
  event: RuntimeEvent,
): TimelineMessage[] {
  const nextMessages = cloneMessages(messages);

  if (!event.runId || !event.sessionId) {
    return nextMessages;
  }

  if (event.eventType === 'run.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    ensureProcessBlock(assistant, event).status = 'running';
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.started') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    process.status = 'running';
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.text_delta') {
    const payload = event.payload as { modelCallId?: string; delta?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const answer = ensureAnswerBlock(assistant, event, payload.modelCallId ?? event.runId);
    answer.text += payload.delta ?? '';
    answer.status = 'streaming';
    answer.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.tool_call') {
    const payload = event.payload as {
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      modelCallId?: string;
    };
    const assistant = ensureAssistantMessage(nextMessages, event);
    moveAnswerIntoProcess(assistant, event, payload.modelCallId ?? event.runId);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolName = payload.toolName ?? 'unknown_tool';
    item.inputSummary = summarizeInput(payload.input);
    item.status = 'running';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_call.started') {
    const payload = event.payload as { toolCallId?: string; toolExecutionId?: string; toolName?: string; input?: unknown };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolName = payload.toolName ?? item.toolName;
    item.inputSummary = item.inputSummary ?? summarizeInput(payload.input);
    item.status = 'running';
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_call.completed' || event.eventType === 'tool_call.failed') {
    const payload = event.payload as { toolCallId?: string; toolExecutionId?: string; toolName?: string; error?: { message?: string } };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolName = payload.toolName ?? item.toolName;
    item.status = event.eventType === 'tool_call.completed' ? 'succeeded' : 'failed';
    item.resultSummary = payload.error?.message ?? item.resultSummary;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'tool_result.created') {
    const payload = event.payload as {
      toolCallId?: string;
      toolExecutionId?: string;
      toolResultId?: string;
      toolName?: string;
      kind?: string;
      summary?: string;
    };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const item = ensureToolItem(process, payload.toolCallId ?? event.eventId, event.createdAt);
    item.toolExecutionId = payload.toolExecutionId;
    item.toolResultId = payload.toolResultId;
    item.toolName = payload.toolName ?? item.toolName;
    item.status = payload.kind === 'success' ? 'succeeded' : payload.kind === 'policy_denied' || payload.kind === 'user_rejected' ? 'denied' : 'failed';
    item.resultSummary = payload.summary;
    item.updatedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'model_call.completed') {
    const payload = event.payload as { modelCallId?: string; finishReason?: string };
    const assistant = ensureAssistantMessage(nextMessages, event);
    const answer = findAnswerBlock(assistant, payload.modelCallId ?? event.runId);
    if (answer && payload.finishReason !== 'tool_calls') {
      answer.status = payload.finishReason === 'failed' ? 'failed' : 'completed';
      answer.updatedAt = event.createdAt;
    }
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'run.completed') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    const answer = assistant.blocks.find((block): block is AnswerTextBlock => block.kind === 'answer_text');
    process.status = 'completed';
    process.endedAt = event.createdAt;
    process.updatedAt = event.createdAt;
    if (answer) {
      answer.status = 'completed';
      answer.updatedAt = event.createdAt;
    }
    assistant.updatedAt = event.createdAt;
    return nextMessages;
  }

  if (event.eventType === 'run.failed' || event.eventType === 'run.cancelled') {
    const assistant = ensureAssistantMessage(nextMessages, event);
    const process = ensureProcessBlock(assistant, event);
    process.status = event.eventType === 'run.failed' ? 'failed' : 'cancelled';
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

function ensureAssistantMessage(messages: TimelineMessage[], event: RuntimeEvent): TimelineAssistantMessage {
  const existing = messages.find(
    (message): message is TimelineAssistantMessage =>
      message.role === 'assistant' && message.runId === event.runId,
  );
  if (existing) return existing;

  const assistant: TimelineAssistantMessage = {
    messageId: event.messageId ?? `assistant:${event.runId}`,
    role: 'assistant',
    projectId: 'runtime',
    sessionId: event.sessionId ?? 'session:unknown',
    runId: event.runId ?? event.eventId,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    turnOrder: 1,
    blocks: [],
  };
  messages.push(assistant);
  return assistant;
}

function ensureProcessBlock(assistant: TimelineAssistantMessage, event: RuntimeEvent): ProcessDisclosureBlock {
  const existing = assistant.blocks.find((block): block is ProcessDisclosureBlock => block.kind === 'process_disclosure');
  if (existing) return existing;
  const block: ProcessDisclosureBlock = {
    blockId: `process:${event.runId}`,
    kind: 'process_disclosure',
    runId: event.runId ?? event.eventId,
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
  event: RuntimeEvent,
  textId: string,
): AnswerTextBlock {
  const existing = findAnswerBlock(assistant, textId);
  if (existing) return existing;
  const block: AnswerTextBlock = {
    blockId: `answer:${event.runId}`,
    kind: 'answer_text',
    runId: event.runId ?? event.eventId,
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

function moveAnswerIntoProcess(assistant: TimelineAssistantMessage, event: RuntimeEvent, textId: string): void {
  const answer = findAnswerBlock(assistant, textId);
  if (!answer || !answer.text) return;

  const process = ensureProcessBlock(assistant, event);
  const item: AssistantTextItem = {
    itemId: `prelude:${textId}`,
    kind: 'assistant_text',
    textId: `prelude:${textId}`,
    phase: 'prelude',
    status: 'completed',
    text: answer.text,
    format: 'markdown',
    createdAt: answer.createdAt,
    updatedAt: event.createdAt,
  };
  process.items.push(item);
  assistant.blocks = assistant.blocks.filter((block) => block !== answer);
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
    status: 'running',
    createdAt,
    updatedAt: createdAt,
  };
  process.items.push(item);
  return item;
}

function summarizeInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}
