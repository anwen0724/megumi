import type {
  RunAction,
  RunObservation,
  Run,
  RunStep,
} from '@megumi/shared/session-run-contracts';
import type { PermissionModeState } from '@megumi/shared/permission-snapshot-contracts';
import type { JsonObject } from '@megumi/shared/json';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { normalizeRuntimeError } from '../runtime-exception';
import {
  createContextUpdateInputPreview,
  toContextPatchAppliedPayload,
  toContextPatchRejectedPayload,
} from './context';
import { toArtifactReferencedPayload } from './artifacts';
import {
  createActionRequestedEvent,
  createArtifactReferencedEvent,
  createCheckpointCreatedEvent,
  createContextEffectiveUpdatedEvent,
  createContextPatchAppliedEvent,
  createContextPatchRejectedEvent,
  createContextPatchRequestedEvent,
  createObservationReceivedEvent,
  createRunCancelRequestedEvent,
  createRunCompletedEvent,
  createRunCreatedEvent,
  createRunFailedEvent,
  createRunStartedEvent,
  createRunStatusChangedEvent,
  createStepCompletedEvent,
  createStepCreatedEvent,
  createStepFailedEvent,
  createStepStatusChangedEvent,
} from './events';
import {
  createCancelObservation,
  createCheckpointObservation,
  toCheckpointCreatedPayload,
} from './recovery';
import {
  createDefaultRunIds,
  defaultRunClock,
  type RunIdFactory,
  type RunTurnInput,
  type RunTurnResult,
} from './types';
import {
  createPermissionModeRuntimeInstruction,
  resolvePermissionModeState,
} from './permission-mode';

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const clock = input.clock ?? defaultRunClock;
  const ids = { ...createDefaultRunIds(), ...input.ids } as RunIdFactory;
  let sequence = 0;
  const events: RuntimeEvent[] = [];
  const observations: RunObservation[] = [];
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };
  const emit = async (event: RuntimeEvent) => {
    events.push(event);
    await input.lifecycle.appendEvent(event);
  };
  const runId = ids.runId();
  const createdAt = clock.now();
  const resolvedPermissionModeState = resolvePermissionModeState({
    permissionMode: input.permissionMode,
    permissionModeState: input.permissionModeState,
  });
  const permissionModeInstruction = createPermissionModeRuntimeInstruction(resolvedPermissionModeState);
  const actionKind = input.actionKind ?? (input.contextPatch ? 'update_context' : 'emit_message');
  const stepKind = stepKindForAction(actionKind);

  let run: Run = {
    runId,
    sessionId: input.sessionId,
    ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
    mode: resolvedPermissionModeState.permissionMode,
    ...(input.permissionSnapshotRef ? { permissionSnapshotRef: input.permissionSnapshotRef } : {}),
    goal: input.goal,
    status: 'queued',
    createdAt,
    ...(input.sourcePlanId ? { sourcePlanId: input.sourcePlanId } : {}),
    metadata: {
      permissionMode: permissionModeInstruction.permissionMode,
    } satisfies JsonObject,
  };

  await input.lifecycle.saveRun(run);
  await emit(createRunCreatedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt,
    mode: resolvedPermissionModeState.permissionMode,
    goal: input.goal,
    ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
  }));

  const runStartedAt = clock.now();
  run = { ...run, status: 'running', startedAt: runStartedAt };
  await input.lifecycle.saveRun(run);
  await emit(createRunStatusChangedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: runStartedAt,
    from: 'queued',
    to: 'running',
  }));
  await emit(createRunStartedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: runStartedAt,
  }));

  let step: RunStep = {
    stepId: ids.stepId(),
    runId,
    kind: stepKind,
    status: 'pending',
    title: titleForStepKind(stepKind),
  };
  await input.lifecycle.saveStep(step);
  await emit(createStepCreatedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: clock.now(),
    step,
  }));

  const stepStartedAt = clock.now();
  step = { ...step, status: 'running', startedAt: stepStartedAt };
  await input.lifecycle.saveStep(step);
  await emit(createStepStatusChangedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    stepId: step.stepId,
    sequence: nextSequence(),
    createdAt: stepStartedAt,
    from: 'pending',
    to: 'running',
  }));

  const actionInputPreview: RunAction['inputPreview'] | undefined = input.contextPatch
    ? createContextUpdateInputPreview(input.contextPatch) as unknown as RunAction['inputPreview']
    : input.actionInput
      ?? input.actionInputPreview
      ?? createDefaultPermissionModeActionInputPreview(resolvedPermissionModeState);

  let action: RunAction = {
    actionId: ids.actionId(),
    runId,
    stepId: step.stepId,
    kind: actionKind,
    status: 'requested',
    requestedAt: clock.now(),
    ...(actionInputPreview ? { inputPreview: actionInputPreview } : {}),
  };
  await input.lifecycle.saveAction(action);
  await emit(createActionRequestedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: action.requestedAt,
    action,
  }));
  if (action.kind === 'update_context' && input.contextPatch) {
    await emit(createContextPatchRequestedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      stepId: step.stepId,
      actionId: action.actionId,
      sequence: nextSequence(),
      createdAt: action.requestedAt,
      payload: createContextUpdateInputPreview(input.contextPatch),
    }));
  }

  try {
    const recoveryObservation = createRecoveryObservationForAction(action, {
      ids,
      clock,
      runId: run.runId,
      stepId: step.stepId,
    });
    const observation = recoveryObservation ?? await input.hostBoundary.handleAction(action);
    observations.push(observation);
    action = { ...action, status: 'completed', completedAt: clock.now() };
    await input.lifecycle.saveAction(action);
    await input.lifecycle.saveObservation(observation);
    await emit(createObservationReceivedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: observation.receivedAt,
      observation,
    }));
    if (action.kind === 'save_checkpoint') {
      await emit(createCheckpointCreatedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
      }, toCheckpointCreatedPayload(observation)));
    }
    if (action.kind === 'cancel') {
      await emit(createRunCancelRequestedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
      }, {
        cancelRequestId: readString(observation.metadata ?? {}, 'cancelRequestId'),
        requestedBy: 'user',
        reason: readString(observation.metadata ?? {}, 'reason') as never,
        scope: readString(observation.metadata ?? {}, 'scope') as never,
      }));
    }
    const appliedPayload = toContextPatchAppliedPayload(observation);
    const rejectedPayload = toContextPatchRejectedPayload(observation);

    if (appliedPayload) {
      await emit(createContextPatchAppliedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        stepId: step.stepId,
        actionId: action.actionId,
        observationId: observation.observationId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
        payload: appliedPayload,
      }));

      if (appliedPayload.effectiveContextBuildId) {
        await emit(createContextEffectiveUpdatedEvent({
          eventId: ids.eventId(),
          runId,
          sessionId: input.sessionId,
          stepId: step.stepId,
          sequence: nextSequence(),
          createdAt: observation.receivedAt,
          payload: {
            contextId: String(input.initialContext?.contextId ?? 'unknown-context'),
            effectiveContextBuildId: appliedPayload.effectiveContextBuildId,
            sourceCount: 0,
            redactionCount: 0,
            truncationCount: 0,
          },
        }));
      }
    }

    if (rejectedPayload) {
      await emit(createContextPatchRejectedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        stepId: step.stepId,
        actionId: action.actionId,
        observationId: observation.observationId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
        payload: rejectedPayload,
      }));
    }

    const artifactReferencedPayload = toArtifactReferencedPayload(observation);

    if (artifactReferencedPayload) {
      await emit(createArtifactReferencedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        stepId: step.stepId,
        actionId: action.actionId,
        observationId: observation.observationId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
      }, artifactReferencedPayload));
    }

    if (isApprovalWaitObservation(observation)) {
      const waitingAt = clock.now();
      action = { ...action, status: 'waiting_for_approval' };
      step = { ...step, status: 'waiting_for_approval' };
      run = { ...run, status: 'waiting_for_approval' };
      await input.lifecycle.saveAction(action);
      await input.lifecycle.saveStep(step);
      await input.lifecycle.saveRun(run);
      await emit(createStepStatusChangedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        stepId: step.stepId,
        sequence: nextSequence(),
        createdAt: waitingAt,
        from: 'running',
        to: 'waiting_for_approval',
      }));
      await emit(createRunStatusChangedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        sequence: nextSequence(),
        createdAt: waitingAt,
        from: 'running',
        to: 'waiting_for_approval',
      }));
      return { run, step, action, observation, observations, events, context: input.initialContext };
    }

    const stepCompletedAt = clock.now();
    step = { ...step, status: 'succeeded', completedAt: stepCompletedAt };
    await input.lifecycle.saveStep(step);
    await emit(createStepStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      stepId: step.stepId,
      sequence: nextSequence(),
      createdAt: stepCompletedAt,
      from: 'running',
      to: 'succeeded',
    }));
    await emit(createStepCompletedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: stepCompletedAt,
      step,
    }));

    const runCompletedAt = clock.now();
    run = { ...run, status: 'completed', completedAt: runCompletedAt };
    await input.lifecycle.saveRun(run);
    await emit(createRunStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: runCompletedAt,
      from: 'running',
      to: 'completed',
    }));
    await emit(createRunCompletedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: runCompletedAt,
    }));

    return { run, step, action, observation, observations, events, context: input.initialContext };
  } catch (error) {
    const runtimeError = normalizeRuntimeError(error, {
      source: 'core',
      debugId: ids.debugId(),
      fallbackMessage: 'Agent runtime failed.',
    });
    const failedAt = clock.now();
    action = { ...action, status: 'failed', completedAt: failedAt, error: runtimeError };
    step = { ...step, status: 'failed', completedAt: failedAt, error: runtimeError };
    run = { ...run, status: 'failed', completedAt: failedAt, error: runtimeError };
    const observation: RunObservation = {
      observationId: ids.observationId(),
      runId,
      stepId: step.stepId,
      actionId: action.actionId,
      source: 'runtime',
      kind: 'runtime_error',
      receivedAt: clock.now(),
      summary: runtimeError.message,
      error: runtimeError,
    };
    observations.push(observation);

    await input.lifecycle.saveAction(action);
    await input.lifecycle.saveStep(step);
    await input.lifecycle.saveRun(run);
    await input.lifecycle.saveObservation(observation);
    await emit(createObservationReceivedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: observation.receivedAt,
      observation,
    }));
    await emit(createStepStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      stepId: step.stepId,
      sequence: nextSequence(),
      createdAt: failedAt,
      from: 'running',
      to: 'failed',
    }));
    await emit(createStepFailedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: failedAt,
      step,
      error: runtimeError,
    }));
    await emit(createRunStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: failedAt,
      from: 'running',
      to: 'failed',
    }));
    await emit(createRunFailedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: failedAt,
      error: runtimeError,
    }));

    return { run, step, action, observation, observations, events, context: input.initialContext };
  }
}

function createRecoveryObservationForAction(
  action: RunAction,
  input: {
    ids: RunIdFactory;
    clock: { now(): string };
    runId: string;
    stepId: string;
  },
): RunObservation | undefined {
  if (action.kind === 'save_checkpoint') {
    const metadata = readJsonObject(action.inputPreview);
    return createCheckpointObservation({
      observationId: input.ids.observationId(),
      runId: input.runId,
      stepId: input.stepId,
      actionId: action.actionId,
      checkpointId: input.ids.checkpointId(),
      reason: readString(metadata, 'reason', 'manual') as never,
      boundary: readString(metadata, 'boundary', 'run_boundary') as never,
      stateSummary: readString(metadata, 'stateSummary', 'Checkpoint saved.'),
      receivedAt: input.clock.now(),
    });
  }

  if (action.kind === 'cancel') {
    const metadata = readJsonObject(action.inputPreview);
    return createCancelObservation({
      observationId: input.ids.observationId(),
      runId: input.runId,
      stepId: input.stepId,
      actionId: action.actionId,
      cancelRequestId: input.ids.cancelRequestId(),
      reason: readString(metadata, 'reason', 'user_requested') as never,
      scope: readString(metadata, 'scope', 'run') as never,
      receivedAt: input.clock.now(),
    });
  }

  return undefined;
}

function createDefaultPermissionModeActionInputPreview(
  state: PermissionModeState,
): RunAction['inputPreview'] | undefined {
  return {
    permissionMode: state.permissionMode,
  };
}

function readJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: Record<string, unknown>, key: string, fallback?: string): string {
  const item = value[key];
  if (typeof item === 'string' && item.length > 0) {
    return item;
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new Error(`Missing recovery metadata: ${key}`);
}

function stepKindForAction(actionKind: RunAction['kind']): RunStep['kind'] {
  if (actionKind === 'update_context') {
    return 'context';
  }
  if (actionKind === 'create_artifact') {
    return 'artifact';
  }
  if (actionKind === 'update_memory') {
    return 'memory';
  }
  if (actionKind === 'save_checkpoint' || actionKind === 'recover' || actionKind === 'cancel') {
    return 'checkpoint';
  }
  return 'model';
}

function titleForStepKind(kind: RunStep['kind']): string {
  if (kind === 'tool') {
    return 'Tool call';
  }
  if (kind === 'approval') {
    return 'Approval request';
  }
  if (kind === 'context') {
    return 'Context update';
  }
  return 'Model response';
}

function isApprovalWaitObservation(observation: RunObservation): boolean {
  return observation.source === 'approval'
    && observation.kind === 'approval_requested'
    && observation.metadata?.status === 'pending';
}
