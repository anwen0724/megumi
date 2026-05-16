import type { ChatRuntimeRequest } from './chat-contracts';
import type { RunId } from './ids';
import type { RuntimeContext } from './runtime-context';
import type { RuntimeError } from './runtime-errors';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from './agent-context-contracts';
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
  TypedRuntimeEvent,
} from './runtime-events';

export interface ChatRuntimeEventFactoryInput<TType extends RuntimeEventType> {
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

export function createChatRuntimeEvent<TType extends RuntimeEventType>(
  input: ChatRuntimeEventFactoryInput<TType>,
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

export interface AgentRuntimeEventFactoryInput<TType extends RuntimeEventType> {
  eventId: string;
  eventType: TType;
  runId: RunId | string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  observationId?: string;
  requestId?: string;
  runtimeContext?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export function createRuntimeEvent<TType extends RuntimeEventType>(
  input: AgentRuntimeEventFactoryInput<TType>,
): RuntimeEvent<RuntimeEventPayloadByType[TType]> & { eventType: TType } {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    runId: input.runId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.actionId ? { actionId: input.actionId } : {}),
    ...(input.observationId ? { observationId: input.observationId } : {}),
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

export function createContextPatchRequestedEvent(input: {
  eventId: string;
  runId: string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: ContextPatchRequestedPayload;
}): RuntimeEvent<ContextPatchRequestedPayload> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.patch.requested',
    source: 'core',
    visibility: 'debug',
    persist: 'required',
  });
}

export function createContextPatchAppliedEvent(input: {
  eventId: string;
  runId: string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  observationId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: ContextPatchAppliedPayload;
}): RuntimeEvent<ContextPatchAppliedPayload> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.patch.applied',
    source: 'core',
    visibility: 'debug',
    persist: 'required',
  });
}

export function createContextPatchRejectedEvent(input: {
  eventId: string;
  runId: string;
  sessionId?: string;
  stepId?: string;
  actionId?: string;
  observationId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: ContextPatchRejectedPayload;
}): RuntimeEvent<ContextPatchRejectedPayload> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.patch.rejected',
    source: 'core',
    visibility: 'debug',
    persist: 'required',
  });
}

export function createContextEffectiveUpdatedEvent(input: {
  eventId: string;
  runId: string;
  sessionId?: string;
  stepId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: ContextEffectiveUpdatedPayload;
}): RuntimeEvent<ContextEffectiveUpdatedPayload> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.effective.updated',
    source: 'core',
    visibility: 'debug',
    persist: 'required',
  });
}

export function createRuntimeCheckpointCreatedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'checkpoint.created'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['checkpoint.created'],
): TypedRuntimeEvent<'checkpoint.created'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'checkpoint.created',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunResumeRequestedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'run.resume_requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.resume_requested'],
): TypedRuntimeEvent<'run.resume_requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.resume_requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunCancelRequestedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'run.cancel_requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.cancel_requested'],
): TypedRuntimeEvent<'run.cancel_requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.cancel_requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunRetryRequestedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'run.retry_requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.retry_requested'],
): TypedRuntimeEvent<'run.retry_requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.retry_requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRunStartedEvent(input: {
  eventId: string;
  request: ChatRuntimeRequest;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
}): RuntimeEvent<RunStartedPayload> {
  return createChatRuntimeEvent({
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
  return createChatRuntimeEvent({
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
  return createChatRuntimeEvent({
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
  return createChatRuntimeEvent({
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
  return createChatRuntimeEvent({
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
  return createChatRuntimeEvent({
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
