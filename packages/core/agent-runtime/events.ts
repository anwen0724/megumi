import type {
  AgentAction,
  AgentObservation,
  AgentRun,
  AgentStep,
} from '@megumi/shared/agent-lifecycle-contracts';
import {
  createContextEffectiveUpdatedEvent,
  createContextPatchAppliedEvent,
  createContextPatchRejectedEvent,
  createContextPatchRequestedEvent,
  createRuntimeArtifactReferencedEvent,
  createRuntimeCheckpointCreatedEvent,
  createRuntimeRunCancelRequestedEvent,
  createRuntimeRunResumeRequestedEvent,
  createRuntimeRunRetryRequestedEvent,
} from '@megumi/shared/runtime-event-factory';
import type {
  ContextEffectiveUpdatedPayload,
  ContextPatchAppliedPayload,
  ContextPatchRejectedPayload,
  ContextPatchRequestedPayload,
} from '@megumi/shared/agent-context-contracts';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent, RuntimeEventPayloadByType } from '@megumi/shared/runtime-events';

interface BaseEventInput {
  eventId: string;
  sessionId: string;
  runId: string;
  sequence: number;
  createdAt: string;
}

export function createAgentRunCreatedEvent(input: BaseEventInput & {
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

export function createAgentRunStartedEvent(input: BaseEventInput): RuntimeEvent {
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

export function createAgentRunStatusChangedEvent(input: BaseEventInput & {
  from: AgentRun['status'];
  to: AgentRun['status'];
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

export function createAgentRunCompletedEvent(input: BaseEventInput): RuntimeEvent {
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

export function createAgentRunFailedEvent(input: BaseEventInput & { error: RuntimeError }): RuntimeEvent {
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

export function createAgentStepCreatedEvent(input: BaseEventInput & { step: AgentStep }): RuntimeEvent {
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

export function createAgentStepStatusChangedEvent(input: BaseEventInput & {
  stepId: string;
  from: AgentStep['status'];
  to: AgentStep['status'];
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

export function createAgentStepCompletedEvent(input: BaseEventInput & { step: AgentStep }): RuntimeEvent {
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

export function createAgentStepFailedEvent(input: BaseEventInput & {
  step: AgentStep;
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

export function createAgentActionRequestedEvent(input: BaseEventInput & { action: AgentAction }): RuntimeEvent {
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

export function createAgentObservationReceivedEvent(input: BaseEventInput & {
  observation: AgentObservation;
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

export function createAgentContextPatchRequestedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  payload: ContextPatchRequestedPayload;
}): RuntimeEvent {
  return createContextPatchRequestedEvent(input);
}

export function createAgentContextPatchAppliedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  observationId?: string;
  payload: ContextPatchAppliedPayload;
}): RuntimeEvent {
  return createContextPatchAppliedEvent(input);
}

export function createAgentContextPatchRejectedEvent(input: BaseEventInput & {
  stepId?: string;
  actionId?: string;
  observationId?: string;
  payload: ContextPatchRejectedPayload;
}): RuntimeEvent {
  return createContextPatchRejectedEvent(input);
}

export function createAgentContextEffectiveUpdatedEvent(input: BaseEventInput & {
  stepId?: string;
  payload: ContextEffectiveUpdatedPayload;
}): RuntimeEvent {
  return createContextEffectiveUpdatedEvent(input);
}

export function createAgentCheckpointCreatedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['checkpoint.created'],
): RuntimeEvent {
  return createRuntimeCheckpointCreatedEvent({ ...input, source: 'core' }, payload);
}

export function createAgentRunResumeRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.resume.requested'],
): RuntimeEvent {
  return createRuntimeRunResumeRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createAgentRunCancelRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.cancel.requested'],
): RuntimeEvent {
  return createRuntimeRunCancelRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createAgentRunRetryRequestedEvent(
  input: BaseEventInput,
  payload: RuntimeEventPayloadByType['run.retry.requested'],
): RuntimeEvent {
  return createRuntimeRunRetryRequestedEvent({ ...input, source: 'core' }, payload);
}

export function createAgentArtifactReferencedEvent(
  input: BaseEventInput & {
    stepId?: string;
    actionId?: string;
    observationId?: string;
  },
  payload: RuntimeEventPayloadByType['artifact.referenced'],
): RuntimeEvent {
  return createRuntimeArtifactReferencedEvent({ ...input, source: 'core' }, payload);
}
