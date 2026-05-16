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
  input: Omit<AgentRuntimeEventFactoryInput<'run.resume.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.resume.requested'],
): TypedRuntimeEvent<'run.resume.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.resume.requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunCancelRequestedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'run.cancel.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.cancel.requested'],
): TypedRuntimeEvent<'run.cancel.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.cancel.requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeRunRetryRequestedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'run.retry.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['run.retry.requested'],
): TypedRuntimeEvent<'run.retry.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.retry.requested',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeArtifactCreatedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'artifact.created'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['artifact.created'],
): TypedRuntimeEvent<'artifact.created'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'artifact.created',
    visibility: 'user',
    persist: 'required',
    payload,
  });
}

export function createRuntimeArtifactVersionCreatedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'artifact.version.created'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['artifact.version.created'],
): TypedRuntimeEvent<'artifact.version.created'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'artifact.version.created',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeArtifactStatusChangedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'artifact.status.changed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['artifact.status.changed'],
): TypedRuntimeEvent<'artifact.status.changed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'artifact.status.changed',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeArtifactReferencedEvent(
  input: Omit<AgentRuntimeEventFactoryInput<'artifact.referenced'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
  payload: RuntimeEventPayloadByType['artifact.referenced'],
): TypedRuntimeEvent<'artifact.referenced'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'artifact.referenced',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeArtifactContentWriteFailedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'artifact.content.write.failed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['artifact.content.write.failed'],
): TypedRuntimeEvent<'artifact.content.write.failed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'artifact.content.write.failed',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryCandidateProposedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.candidate.proposed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.candidate.proposed'],
): TypedRuntimeEvent<'memory.candidate.proposed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.candidate.proposed',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryCandidateAcceptedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.candidate.accepted'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.candidate.accepted'],
): TypedRuntimeEvent<'memory.candidate.accepted'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.candidate.accepted',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryCandidateRejectedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.candidate.rejected'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.candidate.rejected'],
): TypedRuntimeEvent<'memory.candidate.rejected'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.candidate.rejected',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecordCreatedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.record.created'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.record.created'],
): TypedRuntimeEvent<'memory.record.created'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.record.created',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecordUpdatedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.record.updated'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.record.updated'],
): TypedRuntimeEvent<'memory.record.updated'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.record.updated',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecordStatusChangedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.record.status.changed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.record.status.changed'],
): TypedRuntimeEvent<'memory.record.status.changed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.record.status.changed',
    visibility: 'system',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecallRequestedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.recall.requested'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.recall.requested'],
): TypedRuntimeEvent<'memory.recall.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.recall.requested',
    visibility: 'debug',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecallCompletedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.recall.completed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.recall.completed'],
): TypedRuntimeEvent<'memory.recall.completed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.recall.completed',
    visibility: 'debug',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryRecallFailedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.recall.failed'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.recall.failed'],
): TypedRuntimeEvent<'memory.recall.failed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.recall.failed',
    visibility: 'debug',
    persist: 'required',
    payload,
  });
}

export function createRuntimeMemoryAccessRecordedEvent(
  input: Omit<
    AgentRuntimeEventFactoryInput<'memory.access.recorded'>,
    'eventType' | 'visibility' | 'persist' | 'payload'
  >,
  payload: RuntimeEventPayloadByType['memory.access.recorded'],
): TypedRuntimeEvent<'memory.access.recorded'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'memory.access.recorded',
    visibility: 'debug',
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
