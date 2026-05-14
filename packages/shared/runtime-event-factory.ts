import type { ChatRuntimeRequest } from './chat-contracts';
import type { RunId } from './ids';
import type { RuntimeContext } from './runtime-context';
import type { RuntimeError } from './runtime-errors';
import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  RunCancelledPayload,
  RunCompletedPayload,
  RunFailedPayload,
  RunStartedPayload,
  RuntimeEvent,
  RuntimeEventPayloadByType,
  RuntimeEventPersistMode,
  RuntimeEventSource,
  RuntimeEventType,
  RuntimeEventVisibility,
} from './runtime-events';

export interface RuntimeEventFactoryInput<TType extends RuntimeEventType> {
  eventId: string;
  eventType: TType;
  runId: RunId | string;
  request: ChatRuntimeRequest;
  runtimeContext?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export function createRuntimeEvent<TType extends RuntimeEventType>(
  input: RuntimeEventFactoryInput<TType>,
): RuntimeEvent<RuntimeEventPayloadByType[TType]> & { eventType: TType } {
  const context = input.runtimeContext ?? input.request.runtimeContext;

  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    runId: input.runId,
    sessionId: input.request.sessionId,
    requestId: input.request.requestId,
    ...(context ? { context } : {}),
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: input.source,
    visibility: input.visibility,
    persist: input.persist,
    payload: input.payload,
  };
}

export function createRunStartedEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
}): RuntimeEvent<RunStartedPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'run.started',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: {
      providerId: input.request.providerId,
      modelId: String(input.request.modelId),
      runKind: input.request.context?.composerMode === 'agent' ? 'agent' : 'chat',
    },
  });
}

export function createRunCompletedEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  payload?: RunCompletedPayload;
}): RuntimeEvent<RunCompletedPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'run.completed',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'system',
    persist: 'required',
    payload: input.payload ?? {},
  });
}

export function createRunFailedEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  error: RuntimeError;
}): RuntimeEvent<RunFailedPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'run.failed',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: input.error.source === 'provider' ? 'provider' : 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      error: input.error,
    },
  });
}

export function createRunCancelledEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  reason: string;
}): RuntimeEvent<RunCancelledPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'run.cancelled',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      reason: input.reason,
    },
  });
}

export function createAssistantDeltaEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  delta: string;
}): RuntimeEvent<AssistantOutputDeltaPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'assistant.output.delta',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'transient',
    payload: {
      delta: input.delta,
    },
  });
}

export function createAssistantCompletedEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  payload: AssistantOutputCompletedPayload;
}): RuntimeEvent<AssistantOutputCompletedPayload> {
  return createRuntimeEvent({
    eventId: input.eventId,
    eventType: 'assistant.output.completed',
    request: input.request,
    runId: input.runId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: input.payload,
  });
}
