import type {
  AgentAction,
  AgentObservation,
  AgentRun,
  AgentStep,
} from '@megumi/shared/agent-lifecycle-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import { normalizeRuntimeError } from '../runtime-exception';
import {
  createContextUpdateInputPreview,
  toContextPatchAppliedPayload,
  toContextPatchRejectedPayload,
} from './context';
import {
  createAgentActionRequestedEvent,
  createAgentContextEffectiveUpdatedEvent,
  createAgentContextPatchAppliedEvent,
  createAgentContextPatchRejectedEvent,
  createAgentContextPatchRequestedEvent,
  createAgentObservationReceivedEvent,
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
  createDefaultAgentRuntimeIds,
  defaultAgentRuntimeClock,
  type AgentRuntimeIdFactory,
  type RunAgentTurnInput,
  type RunAgentTurnResult,
} from './types';

export async function runAgentTurn(input: RunAgentTurnInput): Promise<RunAgentTurnResult> {
  const clock = input.clock ?? defaultAgentRuntimeClock;
  const ids = { ...createDefaultAgentRuntimeIds(), ...input.ids } as AgentRuntimeIdFactory;
  let sequence = 0;
  const events: RuntimeEvent[] = [];
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

  let run: AgentRun = {
    runId,
    sessionId: input.sessionId,
    ...(input.triggerMessageId ? { triggerMessageId: input.triggerMessageId } : {}),
    mode: input.mode,
    goal: input.goal,
    status: 'queued',
    createdAt,
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
    kind: 'model',
    status: 'pending',
    title: 'Agent response',
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

  const actionKind = input.actionKind ?? (input.contextPatch ? 'update_context' : 'emit_message');
  const actionInputPreview: AgentAction['inputPreview'] | undefined = input.contextPatch
    ? createContextUpdateInputPreview(input.contextPatch) as unknown as AgentAction['inputPreview']
    : input.actionInputPreview;

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
    const observation = await input.hostBoundary.handleAction(action);
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

    return { run, step, action, observation, events, context: input.initialContext };
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

    return { run, step, action, observation, events, context: input.initialContext };
  }
}
