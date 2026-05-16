import type {
  AgentAction,
  AgentObservation,
  AgentRun,
  AgentStep,
} from '@megumi/shared/agent-lifecycle-contracts';
import type { RunMode } from '@megumi/shared/agent-run-mode-contracts';
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
  createAgentActionRequestedEvent,
  createAgentArtifactReferencedEvent,
  createAgentCheckpointCreatedEvent,
  createAgentContextEffectiveUpdatedEvent,
  createAgentContextPatchAppliedEvent,
  createAgentContextPatchRejectedEvent,
  createAgentContextPatchRequestedEvent,
  createAgentObservationReceivedEvent,
  createAgentRunCancelRequestedEvent,
  createAgentRunCompletedEvent,
  createAgentRunCreatedEvent,
  createAgentRunFailedEvent,
  createAgentRunStartedEvent,
  createAgentRunStatusChangedEvent,
  createAgentStepCompletedEvent,
  createAgentStepCreatedEvent,
  createAgentStepFailedEvent,
  createAgentStepStatusChangedEvent,
} from './events';
import {
  createCancelObservation,
  createCheckpointObservation,
  toCheckpointCreatedPayload,
} from './recovery';
import {
  createDefaultAgentRuntimeIds,
  defaultAgentRuntimeClock,
  type AgentRuntimeIdFactory,
  type RunAgentTurnInput,
  type RunAgentTurnResult,
} from './types';
import {
  createRunModeRuntimeInstruction,
  defaultActionKindForRunMode,
  resolveRunModeSnapshot,
} from './run-mode';

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult> {
  const clock = input.clock ?? defaultAgentRuntimeClock;
  const ids = { ...createDefaultAgentRuntimeIds(), ...input.ids } as AgentRuntimeIdFactory;
  let sequence = 0;
  const events: RuntimeEvent[] = [];
  const observations: AgentObservation[] = [];
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
  const resolvedMode = resolveRunModeSnapshot({
    mode: input.mode,
    modeSnapshot: input.modeSnapshot,
  });
  const runModeInstruction = createRunModeRuntimeInstruction(resolvedMode);
  const actionKind = input.actionKind
    ?? (input.contextPatch ? 'update_context' : defaultActionKindForRunMode(resolvedMode));
  const stepKind = stepKindForAction(actionKind);

  let run: AgentRun = {
    runId,
    sessionId: input.sessionId,
    ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
    mode: resolvedMode.preset ?? input.mode,
    ...(input.modeSnapshotRef ? { modeSnapshotRef: input.modeSnapshotRef } : {}),
    goal: input.goal,
    status: 'queued',
    createdAt,
    ...(input.sourcePlanId ? { sourcePlanId: input.sourcePlanId } : {}),
    metadata: {
      runMode: {
        taskIntent: runModeInstruction.taskIntent,
        permissionMode: runModeInstruction.permissionMode,
        outputExpectation: runModeInstruction.outputExpectation,
      },
    } satisfies JsonObject,
  };

  await input.lifecycle.saveRun(run);
  await emit(createAgentRunCreatedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt,
    mode: input.mode,
    goal: input.goal,
    ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
  }));

  const runStartedAt = clock.now();
  run = { ...run, status: 'running', startedAt: runStartedAt };
  await input.lifecycle.saveRun(run);
  await emit(createAgentRunStatusChangedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: runStartedAt,
    from: 'queued',
    to: 'running',
  }));
  await emit(createAgentRunStartedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: runStartedAt,
  }));

  let step: AgentStep = {
    stepId: ids.stepId(),
    runId,
    kind: stepKind,
    status: 'pending',
    title: titleForStepKind(stepKind),
  };
  await input.lifecycle.saveStep(step);
  await emit(createAgentStepCreatedEvent({
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
  await emit(createAgentStepStatusChangedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    stepId: step.stepId,
    sequence: nextSequence(),
    createdAt: stepStartedAt,
    from: 'pending',
    to: 'running',
  }));

  const actionInputPreview: AgentAction['inputPreview'] | undefined = input.contextPatch
    ? createContextUpdateInputPreview(input.contextPatch) as unknown as AgentAction['inputPreview']
    : input.actionInput ?? input.actionInputPreview ?? createDefaultRunModeActionInputPreview(resolvedMode);

  let action: AgentAction = {
    actionId: ids.actionId(),
    runId,
    stepId: step.stepId,
    kind: actionKind,
    status: 'requested',
    requestedAt: clock.now(),
    ...(actionInputPreview ? { inputPreview: actionInputPreview } : {}),
  };
  await input.lifecycle.saveAction(action);
  await emit(createAgentActionRequestedEvent({
    eventId: ids.eventId(),
    runId,
    sessionId: input.sessionId,
    sequence: nextSequence(),
    createdAt: action.requestedAt,
    action,
  }));
  if (action.kind === 'update_context' && input.contextPatch) {
    await emit(createAgentContextPatchRequestedEvent({
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
    await emit(createAgentObservationReceivedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: observation.receivedAt,
      observation,
    }));
    if (action.kind === 'save_checkpoint') {
      await emit(createAgentCheckpointCreatedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        sequence: nextSequence(),
        createdAt: observation.receivedAt,
      }, toCheckpointCreatedPayload(observation)));
    }
    if (action.kind === 'cancel') {
      await emit(createAgentRunCancelRequestedEvent({
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
      await emit(createAgentContextPatchAppliedEvent({
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
        await emit(createAgentContextEffectiveUpdatedEvent({
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
      await emit(createAgentContextPatchRejectedEvent({
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
      await emit(createAgentArtifactReferencedEvent({
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
      await emit(createAgentStepStatusChangedEvent({
        eventId: ids.eventId(),
        runId,
        sessionId: input.sessionId,
        stepId: step.stepId,
        sequence: nextSequence(),
        createdAt: waitingAt,
        from: 'running',
        to: 'waiting_for_approval',
      }));
      await emit(createAgentRunStatusChangedEvent({
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
    await emit(createAgentStepStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      stepId: step.stepId,
      sequence: nextSequence(),
      createdAt: stepCompletedAt,
      from: 'running',
      to: 'succeeded',
    }));
    await emit(createAgentStepCompletedEvent({
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
    await emit(createAgentRunStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: runCompletedAt,
      from: 'running',
      to: 'completed',
    }));
    await emit(createAgentRunCompletedEvent({
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
    const observation: AgentObservation = {
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
    await emit(createAgentObservationReceivedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: observation.receivedAt,
      observation,
    }));
    await emit(createAgentStepStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      stepId: step.stepId,
      sequence: nextSequence(),
      createdAt: failedAt,
      from: 'running',
      to: 'failed',
    }));
    await emit(createAgentStepFailedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: failedAt,
      step,
      error: runtimeError,
    }));
    await emit(createAgentRunStatusChangedEvent({
      eventId: ids.eventId(),
      runId,
      sessionId: input.sessionId,
      sequence: nextSequence(),
      createdAt: failedAt,
      from: 'running',
      to: 'failed',
    }));
    await emit(createAgentRunFailedEvent({
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
  action: AgentAction,
  input: {
    ids: AgentRuntimeIdFactory;
    clock: { now(): string };
    runId: string;
    stepId: string;
  },
): AgentObservation | undefined {
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

function createDefaultRunModeActionInputPreview(mode: RunMode): AgentAction['inputPreview'] | undefined {
  if (mode.outputExpectation !== 'implementation_plan_artifact') {
    return undefined;
  }

  return {
    artifactKind: 'implementation_plan',
    taskIntent: mode.taskIntent,
    permissionMode: mode.permissionMode,
    outputExpectation: mode.outputExpectation,
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

function stepKindForAction(actionKind: AgentAction['kind']): AgentStep['kind'] {
  if (actionKind === 'call_tool') {
    return 'tool';
  }
  if (actionKind === 'request_approval') {
    return 'approval';
  }
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

function titleForStepKind(kind: AgentStep['kind']): string {
  if (kind === 'tool') {
    return 'Tool call';
  }
  if (kind === 'approval') {
    return 'Approval request';
  }
  if (kind === 'context') {
    return 'Context update';
  }
  return 'Agent response';
}

function isApprovalWaitObservation(observation: AgentObservation): boolean {
  return observation.source === 'approval'
    && observation.kind === 'approval_requested'
    && observation.metadata?.status === 'pending';
}
