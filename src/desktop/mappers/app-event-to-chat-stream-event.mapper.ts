// Maps App events into renderer chat stream events.
import type { AppEvent } from '../../app';
import type { ChatStreamEvent } from '../../shared/renderer-contracts/chat-stream';

export interface ChatStreamProjectionOptions {
  seq?: number;
}

export function mapAppEventToChatStreamEvent(event: AppEvent, options: ChatStreamProjectionOptions = {}): ChatStreamEvent | undefined {
  const base = createBaseEvent(event, options);

  if (event.type === 'turn.started') {
    return {
      ...base,
      eventType: 'turn.started',
      userMessageId: readString(event.payload.userMessageId)
        ?? readString(event.payload.messageId)
        ?? readString(event.payload.clientMessageId)
        ?? `user-message:${base.runId}`,
      clientMessageId: readString(event.payload.clientMessageId),
    };
  }

  if (event.type === 'ai.message.event') {
    return mapAiMessageEvent(event, base);
  }

  if (event.type === 'ai.message.completed') {
    return {
      ...base,
      eventType: 'assistant.text.completed',
      textId: textIdFor(base.runId, event.payload),
      phase: readAssistantPhase(event.payload.phase),
    };
  }

  if (event.type === 'tool.call.created' || event.type === 'tool.execution.started') {
    return {
      ...base,
      eventType: 'tool.started',
      ...toolFields(event.payload),
    };
  }

  if (event.type === 'tool.execution.completed') {
    return {
      ...base,
      eventType: isFailedToolExecution(event.payload) ? 'tool.failed' : 'tool.completed',
      ...toolFields(event.payload),
      errorCode: readString(event.payload.errorCode),
      errorMessage: readErrorMessage(event.payload),
    };
  }

  if (event.type === 'run.status.changed') {
    const status = readString(event.payload.status) ?? readString(event.payload.to);
    if (status === 'completed') return { ...base, eventType: 'turn.completed' };
    if (status === 'failed') return { ...base, eventType: 'turn.failed', errorMessage: readErrorMessage(event.payload) };
    if (status === 'cancelled' || status === 'canceled') return { ...base, eventType: 'turn.cancelled', reason: readString(event.payload.reason) };
  }

  if (event.type === 'run.completed') return { ...base, eventType: 'turn.completed' };
  if (event.type === 'run.failed') return { ...base, eventType: 'turn.failed', errorMessage: readErrorMessage(event.payload) };
  if (event.type === 'run.cancelled' || event.type === 'run.canceled') {
    return { ...base, eventType: 'turn.cancelled', reason: readString(event.payload.reason) };
  }

  return undefined;
}

function createBaseEvent(event: AppEvent, options: ChatStreamProjectionOptions): Omit<ChatStreamEvent, 'eventType'> {
  const runId = readString(event.payload.runId) ?? 'default-run';
  const sessionId = readString(event.payload.sessionId) ?? 'default-session';
  const projectId = readString(event.payload.projectId)
    ?? readString(event.payload.workspaceId)
    ?? 'default-project';
  const streamId = readString(event.payload.streamId) ?? `chat-stream:${runId}`;
  const seq = readNumber(event.payload.seq) ?? readNumber(event.payload.sequence) ?? options.seq ?? 1;

  return {
    eventId: readString(event.payload.eventId) ?? `chat-stream-event:${streamId}:${seq}`,
    projectId,
    sessionId,
    runId,
    streamId,
    streamKind: readString(event.payload.streamKind) ?? 'main',
    seq,
    createdAt: event.occurredAt,
  };
}

function mapAiMessageEvent(
  event: AppEvent,
  base: Omit<ChatStreamEvent, 'eventType'>,
): ChatStreamEvent | undefined {
  const streamEvent = readRecord(event.payload.event);
  if (!streamEvent) return undefined;

  if (streamEvent.type === 'content_block_delta') {
    const delta = readRecord(streamEvent.delta);
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return {
        ...base,
        eventType: 'assistant.text.delta',
        textId: textIdFor(base.runId, event.payload, streamEvent),
        phase: readAssistantPhase(event.payload.phase),
        delta: delta.text,
      };
    }
  }

  if (streamEvent.type === 'content_block_stop') {
    return {
      ...base,
      eventType: 'assistant.text.completed',
      textId: textIdFor(base.runId, event.payload, streamEvent),
      phase: readAssistantPhase(event.payload.phase),
    };
  }

  return undefined;
}

function toolFields(payload: Record<string, unknown>): {
  toolCallId: string;
  toolExecutionId?: string;
  toolResultId?: string;
  toolName: string;
  displayName?: string;
  inputSummary?: string;
  resultSummary?: string;
} {
  return {
    toolCallId: readString(payload.toolCallId) ?? readString(payload.id) ?? 'tool-call:unknown',
    toolExecutionId: readString(payload.toolExecutionId),
    toolResultId: readString(payload.toolResultId),
    toolName: readString(payload.toolName) ?? readString(payload.name) ?? 'unknown_tool',
    displayName: readString(payload.displayName) ?? readString(payload.modelVisibleName),
    inputSummary: readString(payload.inputSummary),
    resultSummary: readString(payload.resultSummary) ?? readString(payload.summary),
  };
}

function textIdFor(runId: string, ...sources: Array<Record<string, unknown> | undefined>): string {
  for (const source of sources) {
    const textId = source ? readString(source.textId) : undefined;
    if (textId) return textId;
  }
  const index = sources.map((source) => source ? readNumber(source.index) : undefined).find((value) => value !== undefined) ?? 0;
  return `assistant-text:${runId}:answer:${index}`;
}

function readAssistantPhase(value: unknown): 'prelude' | 'answer' {
  return value === 'prelude' ? 'prelude' : 'answer';
}

function isFailedToolExecution(payload: Record<string, unknown>): boolean {
  const status = readString(payload.status);
  if (status === 'failed' || status === 'error') return true;
  if (payload.isError === true) return true;
  return payload.error !== undefined;
}

function readErrorMessage(payload: Record<string, unknown>): string | undefined {
  const direct = readString(payload.errorMessage) ?? readString(payload.message);
  if (direct) return direct;
  const error = readRecord(payload.error);
  return error ? readString(error.message) : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
