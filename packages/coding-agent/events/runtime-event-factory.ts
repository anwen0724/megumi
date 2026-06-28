import type {
  RunAction,
  RunObservation,
  Run,
  RunStep,
} from '@megumi/shared/session';
import {
  createContextEffectiveUpdatedEvent as createRuntimeContextEffectiveUpdatedEvent,
  createContextPatchAppliedEvent as createRuntimeContextPatchAppliedEvent,
  createContextPatchRejectedEvent as createRuntimeContextPatchRejectedEvent,
  createContextPatchRequestedEvent as createRuntimeContextPatchRequestedEvent,
  createRuntimeArtifactReferencedEvent,
  createRuntimeCheckpointCreatedEvent,
  createRuntimeRunCancelRequestedEvent,
  createRuntimeRunResumeRequestedEvent,
  createRuntimeRunRetryRequestedEvent,
  createRuntimeEvent,
} from '@megumi/shared/runtime';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from '@megumi/shared/run';
import type { RuntimeContext, RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent, RuntimeEventPayloadByType } from '@megumi/shared/runtime';

interface BaseEventInput {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  createdAt: string;
}

export function createRunCreatedEvent(input: BaseEventInput & {
  mode: string;
  goal: string;
  triggerMessageId?: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.created',
    runId: input.runId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      status: 'queued',
      mode: input.mode,
      goal: input.goal,
      ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
    },
  };
}

export function createRunStartedEvent(input: BaseEventInput): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.started',
    runId: input.runId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { runKind: 'agent' },
  };
}

export function createRunStatusChangedEvent(input: BaseEventInput & {
  from: Run['status'];
  to: Run['status'];
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.status.changed',
    runId: input.runId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { from: input.from, to: input.to },
  };
}

export function createRunCompletedEvent(input: BaseEventInput): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.completed',
    runId: input.runId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {},
  };
}

export function createRunFailedEvent(input: BaseEventInput & { error: RuntimeError }): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'run.failed',
    runId: input.runId,
    sessionId: input.sessionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { error: input.error },
  };
}

export function createStepCreatedEvent(input: BaseEventInput & { step: RunStep }): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'step.created',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.step.stepId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      kind: input.step.kind,
      status: input.step.status,
      ...(input.step.title ? { title: input.step.title } : {}),
    },
  };
}

export function createStepStatusChangedEvent(input: BaseEventInput & {
  stepId: string;
  from: RunStep['status'];
  to: RunStep['status'];
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'step.status.changed',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { from: input.from, to: input.to },
  };
}

export function createStepCompletedEvent(input: BaseEventInput & { step: RunStep }): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'step.completed',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.step.stepId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: { kind: input.step.kind },
  };
}

export function createStepFailedEvent(input: BaseEventInput & {
  step: RunStep;
  error: RuntimeError;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'step.failed',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.step.stepId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      kind: input.step.kind,
      error: input.error,
    },
  };
}

export function createActionRequestedEvent(input: BaseEventInput & { action: RunAction }): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'action.requested',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.action.stepId,
    actionId: input.action.actionId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      kind: input.action.kind,
      status: input.action.status,
      ...(input.action.inputPreview ? { inputPreview: input.action.inputPreview } : {}),
    },
  };
}

export function createObservationReceivedEvent(input: BaseEventInput & {
  observation: RunObservation;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'observation.received',
    runId: input.runId,
    sessionId: input.sessionId,
    stepId: input.observation.stepId,
    actionId: input.observation.actionId,
    observationId: input.observation.observationId,
    sequence: input.sequence,
    createdAt: input.createdAt,
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: {
      source: input.observation.source,
      kind: input.observation.kind,
      ...(input.observation.summary ? { summary: input.observation.summary } : {}),
    },
  };
}

export function createContextPatchRequestedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  payload: ContextPatchRequestedPayload;
}): RuntimeEvent {
  return createRuntimeContextPatchRequestedEvent(input);
}

export function createContextPatchAppliedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  observationId?: string;
  payload: ContextPatchAppliedPayload;
}): RuntimeEvent {
  return createRuntimeContextPatchAppliedEvent(input);
}

export function createContextPatchRejectedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  observationId?: string;
  payload: ContextPatchRejectedPayload;
}): RuntimeEvent {
  return createRuntimeContextPatchRejectedEvent(input);
}

export function createContextEffectiveUpdatedEvent(input: BaseEventInput & {
  stepId?: string;
  payload: ContextEffectiveUpdatedPayload;
}): RuntimeEvent {
  return createRuntimeContextEffectiveUpdatedEvent(input);
}

export function createCheckpointCreatedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['checkpoint.created'],
): RuntimeEvent {
  return createRuntimeCheckpointCreatedEvent({ ...input, source: 'core' }, payload);
}

export function createRunResumeRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.resume.requested'],
): RuntimeEvent {
  return createRuntimeRunResumeRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createRunCancelRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.cancel.requested'],
): RuntimeEvent {
  return createRuntimeRunCancelRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createRunRetryRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.retry.requested'],
): RuntimeEvent {
  return createRuntimeRunRetryRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createArtifactReferencedEvent(
  input: BaseEventInput & {
    stepId?: string;
    actionId?: string;
    observationId?: string;
  },
  payload: RuntimeEventPayloadByType['artifact.referenced'],
): RuntimeEvent {
  return createRuntimeArtifactReferencedEvent({ ...input, source: 'core' }, payload);
}

export function createToolResultsSubmittedToModelInputEvent(input: BaseEventInput & {
  stepId: string;
  requestId: string;
  runtimeContext?: RuntimeContext;
  payload: RuntimeEventPayloadByType['tool.continuation.emitted'];
}): RuntimeEvent {
  return createRuntimeEvent({
    ...input,
    eventType: 'tool.continuation.emitted',
    source: 'tool',
    visibility: 'system',
    persist: 'required',
  });
}

