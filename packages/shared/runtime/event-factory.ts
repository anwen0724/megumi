import type { RunId } from '../primitives/ids';
import type { ModelId } from '../model/contracts';
import type { ProviderId } from '../provider/contracts';
import type { RuntimeContext } from '../runtime/context';
import type { RuntimeError } from '../runtime/errors';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from '../run/context-contracts';
import type {
  AssistantOutputCompletedPayload,
  AssistantOutputDeltaPayload,
  RunCancelledPayload,
  RunCompletedPayload,
  RunFailedPayload,
  RunInterruptedPayload,
  RunStartedPayload,
  RuntimeEvent,
  RuntimeEventPayloadByType,
  RuntimeEventPersistMode,
  RuntimeEventSource,
  RuntimeEventType,
  RuntimeEventVisibility,
  TypedRuntimeEvent,
} from '../runtime/events';

export interface RuntimeEventRequestRef {
  requestId: string;
  sessionId?: string;
  providerId?: ProviderId | string;
  modelId?: ModelId | string;
  runtimeContext?: RuntimeContext;
}

export interface RequestRuntimeEventFactoryInput<TType extends RuntimeEventType> {
  eventId: string;
  eventType: TType;
  runId: RunId | string;
  request: RuntimeEventRequestRef;
  runtimeContext?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: RuntimeEventPayloadByType[TType];
}

export function createRequestRuntimeEvent<TType extends RuntimeEventType>(
  input: RequestRuntimeEventFactoryInput<TType>,
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

export interface RunRuntimeEventFactoryInput<TType extends RuntimeEventType> {
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

export interface SessionScopedRuntimeEventFactoryInput<TType extends RuntimeEventType> {
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

export function createRuntimeEvent<TType extends RuntimeEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
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

function createSessionScopedRuntimeEvent<TType extends RuntimeEventType>(
  input: SessionScopedRuntimeEventFactoryInput<TType>,
): RuntimeEvent<RuntimeEventPayloadByType[TType]> & { eventType: TType } {
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

type ActivePathSessionRuntimeEventInput<TType extends RuntimeEventType> = Omit<
  SessionScopedRuntimeEventFactoryInput<TType>,
  'eventType' | 'source' | 'visibility' | 'persist'
>;

export function createSessionActiveLeafChangedEvent(
  input: ActivePathSessionRuntimeEventInput<'session.active_leaf.changed'>,
): TypedRuntimeEvent<'session.active_leaf.changed'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.active_leaf.changed',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createSessionBranchMarkerCreatedEvent(
  input: ActivePathSessionRuntimeEventInput<'session.branch_marker.created'>,
): TypedRuntimeEvent<'session.branch_marker.created'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.branch_marker.created',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createSessionBranchDraftCancelledEvent(
  input: ActivePathSessionRuntimeEventInput<'session.branch_draft.cancelled'>,
): TypedRuntimeEvent<'session.branch_draft.cancelled'> {
  return createSessionScopedRuntimeEvent({
    ...input,
    eventType: 'session.branch_draft.cancelled',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createModelStepStartedEvent(
  input: RunRuntimeEventFactoryInput<'model.step.started'>,
): TypedRuntimeEvent<'model.step.started'> {
  return createRuntimeEvent(input);
}

export function createModelStepProviderStateRecordedEvent(
  input: RunRuntimeEventFactoryInput<'model.step.provider_state.recorded'>,
): TypedRuntimeEvent<'model.step.provider_state.recorded'> {
  return createRuntimeEvent(input);
}

export function createModelThinkingStartedEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.started'>,
): TypedRuntimeEvent<'model.thinking.started'> {
  return createRuntimeEvent(input);
}

export function createModelThinkingDeltaEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.delta'>,
): TypedRuntimeEvent<'model.thinking.delta'> {
  return createRuntimeEvent(input);
}

export function createModelThinkingCompletedEvent(
  input: RunRuntimeEventFactoryInput<'model.thinking.completed'>,
): TypedRuntimeEvent<'model.thinking.completed'> {
  return createRuntimeEvent(input);
}

export function createModelToolCallDetectedEvent(
  input: RunRuntimeEventFactoryInput<'model.tool_call.detected'>,
): TypedRuntimeEvent<'model.tool_call.detected'> {
  return createRuntimeEvent(input);
}

export function createToolCallCreatedEvent(
  input: RunRuntimeEventFactoryInput<'tool.call.created'>,
): TypedRuntimeEvent<'tool.call.created'> {
  return createRuntimeEvent(input);
}

export function createToolResultCreatedEvent(
  input: RunRuntimeEventFactoryInput<'tool.result.created'>,
): TypedRuntimeEvent<'tool.result.created'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionRequestedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.requested'>,
): TypedRuntimeEvent<'tool.execution.requested'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionValidatedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.validated'>,
): TypedRuntimeEvent<'tool.execution.validated'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionPolicyDecidedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.policy_decided'>,
): TypedRuntimeEvent<'tool.execution.policy_decided'> {
  return createRuntimeEvent(input);
}

export function createPermissionDecisionCreatedEvent(
  input: RunRuntimeEventFactoryInput<'permission.decision.created'>,
): TypedRuntimeEvent<'permission.decision.created'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionApprovalRequestedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.approval_requested'>,
): TypedRuntimeEvent<'tool.execution.approval_requested'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionStartedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.started'>,
): TypedRuntimeEvent<'tool.execution.started'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionCompletedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.completed'>,
): TypedRuntimeEvent<'tool.execution.completed'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionFailedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.failed'>,
): TypedRuntimeEvent<'tool.execution.failed'> {
  return createRuntimeEvent(input);
}

export function createToolExecutionDeniedEvent(
  input: RunRuntimeEventFactoryInput<'tool.execution.denied'>,
): TypedRuntimeEvent<'tool.execution.denied'> {
  return createRuntimeEvent(input);
}

export function createApprovalRequestedEvent(
  input: RunRuntimeEventFactoryInput<'approval.requested'>,
): TypedRuntimeEvent<'approval.requested'> {
  return createRuntimeEvent(input);
}

export function createRunWaitingForApprovalEvent(
  input: RunRuntimeEventFactoryInput<'run.waiting_for_approval'>,
): TypedRuntimeEvent<'run.waiting_for_approval'> {
  return createRuntimeEvent(input);
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

export function createContextCompactionStartedEvent(input: {
  eventId: string;
  runId: string;
  sessionId: string;
  stepId?: string;
  requestId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: RuntimeEventPayloadByType['context.compaction.started'];
}): TypedRuntimeEvent<'context.compaction.started'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.compaction.started',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createContextCompactionCompletedEvent(input: {
  eventId: string;
  runId: string;
  sessionId: string;
  stepId?: string;
  requestId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: RuntimeEventPayloadByType['context.compaction.completed'];
}): TypedRuntimeEvent<'context.compaction.completed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.compaction.completed',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createContextCompactionFailedEvent(input: {
  eventId: string;
  runId: string;
  sessionId: string;
  stepId?: string;
  requestId?: string;
  sequence: number;
  createdAt: string;
  runtimeContext?: RuntimeContext;
  payload: RuntimeEventPayloadByType['context.compaction.failed'];
}): TypedRuntimeEvent<'context.compaction.failed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'context.compaction.failed',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createRuntimeCheckpointCreatedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'checkpoint.created'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
  input: Omit<RunRuntimeEventFactoryInput<'run.resume.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
  input: Omit<RunRuntimeEventFactoryInput<'run.cancel.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
  input: Omit<RunRuntimeEventFactoryInput<'run.retry.requested'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
  input: Omit<RunRuntimeEventFactoryInput<'artifact.created'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
    RunRuntimeEventFactoryInput<'artifact.version.created'>,
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
    RunRuntimeEventFactoryInput<'artifact.status.changed'>,
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
  input: Omit<RunRuntimeEventFactoryInput<'artifact.referenced'>, 'eventType' | 'visibility' | 'persist' | 'payload'>,
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
    RunRuntimeEventFactoryInput<'artifact.content.write.failed'>,
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
    RunRuntimeEventFactoryInput<'memory.candidate.proposed'>,
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
    RunRuntimeEventFactoryInput<'memory.candidate.accepted'>,
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
    RunRuntimeEventFactoryInput<'memory.candidate.rejected'>,
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
    RunRuntimeEventFactoryInput<'memory.record.created'>,
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
    RunRuntimeEventFactoryInput<'memory.record.updated'>,
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
    RunRuntimeEventFactoryInput<'memory.record.status.changed'>,
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
    RunRuntimeEventFactoryInput<'memory.recall.requested'>,
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
    RunRuntimeEventFactoryInput<'memory.recall.completed'>,
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
    RunRuntimeEventFactoryInput<'memory.recall.failed'>,
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
    RunRuntimeEventFactoryInput<'memory.access.recorded'>,
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

export function createWorkspaceChangesDetectedBeforeRetryEvent(
  input: Omit<RunRuntimeEventFactoryInput<'workspace.changes.detected_before_retry'>, 'eventType' | 'visibility' | 'persist'>,
): TypedRuntimeEvent<'workspace.changes.detected_before_retry'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'workspace.changes.detected_before_retry',
    visibility: 'system',
    persist: 'required',
  });
}

export function createWorkspaceRestoreRequestedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'workspace.restore.requested'>, 'eventType' | 'visibility' | 'persist'>,
): TypedRuntimeEvent<'workspace.restore.requested'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'workspace.restore.requested',
    visibility: 'system',
    persist: 'required',
  });
}

export function createWorkspaceRestoreCompletedEvent(
  input: Omit<RunRuntimeEventFactoryInput<'workspace.restore.completed'>, 'eventType' | 'visibility' | 'persist'>,
): TypedRuntimeEvent<'workspace.restore.completed'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'workspace.restore.completed',
    visibility: 'system',
    persist: 'required',
  });
}

export function createRunStartedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
}): RuntimeEvent<RunStartedPayload> {
  return createRequestRuntimeEvent({
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
      ...(input.request.providerId ? { providerId: input.request.providerId } : {}),
      ...(input.request.modelId ? { modelId: String(input.request.modelId) } : {}),
      runKind: 'agent',
    },
  });
}

export function createRunCompletedEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  payload?: RunCompletedPayload;
}): RuntimeEvent<RunCompletedPayload> {
  return createRequestRuntimeEvent({
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
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  error: RuntimeError;
}): RuntimeEvent<RunFailedPayload> {
  return createRequestRuntimeEvent({
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
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  reason: string;
}): RuntimeEvent<RunCancelledPayload> {
  return createRequestRuntimeEvent({
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

export function createRunInterruptedEvent(input: {
  eventId: string;
  runId: RunId | string;
  sessionId: string;
  sequence: number;
  createdAt: string;
  payload: RunInterruptedPayload;
}): TypedRuntimeEvent<'run.interrupted'> {
  return createRuntimeEvent({
    ...input,
    eventType: 'run.interrupted',
    source: 'main',
    visibility: 'system',
    persist: 'required',
  });
}

export function createAssistantDeltaEvent(input: {
  eventId: string;
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  delta: string;
}): RuntimeEvent<AssistantOutputDeltaPayload> {
  return createRequestRuntimeEvent({
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
  request: RuntimeEventRequestRef;
  runId: RunId | string;
  sequence: number;
  createdAt: string;
  payload: AssistantOutputCompletedPayload;
}): RuntimeEvent<AssistantOutputCompletedPayload> {
  return createRequestRuntimeEvent({
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

