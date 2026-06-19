// Projects Agent Runtime events into the renderer chat stream protocol.
import type { AgentRuntimeEvent } from '../../app';
import type { ChatStreamEvent } from '../../shared/renderer-contracts/chat-stream';

export interface ChatStreamProjectionOptions {
  seq?: number;
}

export function mapAgentRuntimeEventToChatStreamEvent(
  event: AgentRuntimeEvent,
  options: ChatStreamProjectionOptions = {},
): ChatStreamEvent | undefined {
  const base = createBaseEvent(event, options);
  const payload = payloadOf(event);

  if (event.type === 'turn.started') {
    return {
      ...base,
      eventType: 'turn.started',
      userMessageId: readString(payload.userMessageId)
        ?? readString(payload.messageId)
        ?? readString(payload.clientMessageId)
        ?? `user-message:${base.runId}`,
      clientMessageId: readString(payload.clientMessageId),
    };
  }

  if (event.type === 'ai.message.event') {
    return mapAiMessageEvent(event, base);
  }

  if (event.type === 'ai.message.completed') {
    return {
      ...base,
      eventType: 'assistant.text.completed',
      textId: textIdFor(base.runId, payload),
      phase: readAssistantPhase(payload.phase),
    };
  }

  if (event.type === 'tool.call.created' || event.type === 'tool.execution.started') {
    return {
      ...base,
      eventType: 'tool.started',
      ...toolFields(payload),
    };
  }

  if (event.type === 'tool.execution.completed') {
    return {
      ...base,
      eventType: isFailedToolExecution(payload) ? 'tool.failed' : 'tool.completed',
      ...toolFields(payload),
      errorCode: readString(payload.errorCode),
      errorMessage: readErrorMessage(payload),
    };
  }

  if (event.type === 'run.status.changed') {
    const status = readString(payload.status) ?? readString(payload.to);
    if (status === 'completed') return { ...base, eventType: 'turn.completed' };
    if (status === 'failed') return { ...base, eventType: 'turn.failed', errorMessage: readErrorMessage(payload) };
    if (status === 'cancelled' || status === 'canceled') return { ...base, eventType: 'turn.cancelled', reason: readString(payload.reason) };
  }

  if (event.type === 'run.completed') return { ...base, eventType: 'turn.completed' };
  if (event.type === 'run.failed') return { ...base, eventType: 'turn.failed', errorMessage: readErrorMessage(payload) };
  if (event.type === 'run.cancelled' || event.type === 'run.canceled') {
    return { ...base, eventType: 'turn.cancelled', reason: readString(payload.reason) };
  }

  return undefined;
}

function createBaseEvent(event: AgentRuntimeEvent, options: ChatStreamProjectionOptions): Omit<ChatStreamEvent, 'eventType'> {
  const payload = payloadOf(event);
  const runId = event.runId ?? readString(payload.runId) ?? 'default-run';
  const sessionId = event.sessionId ?? readString(payload.sessionId) ?? 'default-session';
  const projectId = readString(payload.projectId)
    ?? event.workspaceId
    ?? readString(payload.workspaceId)
    ?? 'default-project';
  const streamId = readString(payload.streamId) ?? `chat-stream:${runId}`;
  const seq = readNumber(payload.seq) ?? readNumber(payload.sequence) ?? options.seq ?? 1;

  return {
    eventId: readString(payload.eventId) ?? `chat-stream-event:${streamId}:${seq}`,
    projectId,
    sessionId,
    runId,
    streamId,
    streamKind: readString(payload.streamKind) ?? 'main',
    seq,
    createdAt: event.occurredAt,
  };
}

function mapAiMessageEvent(
  event: AgentRuntimeEvent,
  base: Omit<ChatStreamEvent, 'eventType'>,
): ChatStreamEvent | undefined {
  const payload = payloadOf(event);
  const streamEvent = readRecord(payload.event);
  if (!streamEvent) return undefined;

  if (streamEvent.type === 'content_block_delta') {
    const delta = readRecord(streamEvent.delta);
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return {
        ...base,
        eventType: 'assistant.text.delta',
        textId: textIdFor(base.runId, payload, streamEvent),
        phase: readAssistantPhase(payload.phase),
        delta: delta.text,
      };
    }
  }

  if (streamEvent.type === 'content_block_stop') {
    return {
      ...base,
      eventType: 'assistant.text.completed',
      textId: textIdFor(base.runId, payload, streamEvent),
      phase: readAssistantPhase(payload.phase),
    };
  }

  return undefined;
}

function payloadOf(event: AgentRuntimeEvent): Record<string, unknown> {
  return event.payload ?? {};
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
