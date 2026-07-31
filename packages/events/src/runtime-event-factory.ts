/*
 * Generic envelope factories shared by event-family creation functions.
 */
import type { RuntimeContext } from './runtime-error';
import type {
  RuntimeEvent,
  RuntimeEventEnvelopeType,
  RuntimeEventPayloadByType,
  RuntimeEventPersistMode,
  RuntimeEventSource,
  RuntimeEventVisibility,
  TypedRuntimeEvent,
} from './runtime-event';

export interface RuntimeEventRequestRef {
  requestId: string;
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  runtimeContext?: RuntimeContext;
}

export interface RequestRuntimeEventFactoryInput<TType extends RuntimeEventEnvelopeType> {
  eventId: string;
  eventType: TType;
  runId: string;
  request: RuntimeEventRequestRef;
  runtimeContext?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export interface RunRuntimeEventFactoryInput<TType extends RuntimeEventEnvelopeType> {
  eventId: string;
  eventType: TType;
  runId: string;
  sessionId?: string;
  actionId?: string;
  observationId?: string;
  messageId?: string;
  requestId?: string;
  runtimeContext?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export interface SessionScopedRuntimeEventFactoryInput<TType extends RuntimeEventEnvelopeType> {
  eventId: string;
  eventType: TType;
  sessionId: string;
  requestId?: string;
  context?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export interface UnscopedRuntimeEventFactoryInput<TType extends RuntimeEventEnvelopeType> {
  eventId: string;
  eventType: TType;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  context?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export function createRequestRuntimeEvent<TType extends RuntimeEventEnvelopeType>(
  input: RequestRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  const context = input.runtimeContext ?? input.request.runtimeContext;
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    runId: input.runId,
    ...(input.request.sessionId ? { sessionId: input.request.sessionId } : {}),
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

export function createRuntimeEvent<TType extends RuntimeEventEnvelopeType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    runId: input.runId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.actionId ? { actionId: input.actionId } : {}),
    ...(input.observationId ? { observationId: input.observationId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    requestId: input.requestId ?? input.runtimeContext?.requestId,
    ...(input.runtimeContext ? { context: input.runtimeContext } : {}),
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: input.source,
    visibility: input.visibility,
    persist: input.persist,
    payload: input.payload,
  };
}

export function createSessionScopedRuntimeEvent<TType extends RuntimeEventEnvelopeType>(
  input: SessionScopedRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  if (!Number.isInteger(input.sequence) || input.sequence <= 0) {
    throw new Error('Runtime event sequence must be a positive integer.');
  }
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    sessionId: input.sessionId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.context ? { context: input.context } : {}),
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: input.source,
    visibility: input.visibility,
    persist: input.persist,
    payload: input.payload,
  };
}

export function createUnscopedRuntimeEvent<TType extends RuntimeEventEnvelopeType>(
  input: UnscopedRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.context ? { context: input.context } : {}),
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: input.source,
    visibility: input.visibility,
    persist: input.persist,
    payload: input.payload,
  };
}

export type EventFactoryInput<TType extends RuntimeEventEnvelopeType> = RunRuntimeEventFactoryInput<TType>;
export type EventFactory<TType extends RuntimeEventEnvelopeType> = (
  input: EventFactoryInput<TType>,
) => RuntimeEvent<RuntimeEventPayloadByType[TType]> & { eventType: TType };
