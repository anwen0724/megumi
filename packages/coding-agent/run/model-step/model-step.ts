import type { RunAction, RunObservation, RunStep } from '@megumi/shared/session';
import type { JsonObject } from '@megumi/shared/primitives';
import type { ModelStepPort } from './model-step-port';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import { normalizeRuntimeError } from '../lifecycle/runtime-errors';
import {
  createRunCancelledEvent,
  createRunFailedEvent,
} from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';

export interface CreateModelStepInputPreviewInput {
  providerId?: string;
  modelId?: string;
  goal: string;
}

export function createModelStepInputPreview(input: CreateModelStepInputPreviewInput): JsonObject {
  return {
    stepKind: 'model',
    goal: input.goal,
    ...(input.providerId ? { providerId: input.providerId } : {}),
    ...(input.modelId ? { modelId: input.modelId } : {}),
  };
}

export function isModelStep(step: Pick<RunStep, 'kind'>): boolean {
  return step.kind === 'model';
}

export function isModelMessageAction(action: Pick<RunAction, 'kind'>): boolean {
  return action.kind === 'emit_message';
}

export function createModelMessageObservation(input: {
  observationId: string;
  runId: string;
  stepId: string;
  actionId: string;
  receivedAt: string;
  summary?: string;
  metadata?: JsonObject;
}): RunObservation {
  return {
    observationId: input.observationId,
    runId: input.runId,
    stepId: input.stepId,
    actionId: input.actionId,
    source: 'runtime',
    kind: 'message_emitted',
    receivedAt: input.receivedAt,
    summary: input.summary ?? 'Model step emitted a message.',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export interface RunModelStepInput {
  request: ModelStepRuntimeRequest;
  modelStepPort: ModelStepPort;
  signal?: AbortSignal;
  eventIdFactory?: () => string;
}

export async function* runModelStep(input: RunModelStepInput): AsyncIterable<RuntimeEvent> {
  let sequence = 0;
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };
  const eventIdFactory = input.eventIdFactory ?? (() => `event:${crypto.randomUUID()}`);

  if (input.signal?.aborted) {
    yield createRunCancelledEvent({
      eventId: eventIdFactory(),
      request: {
        requestId: input.request.requestId,
        sessionId: input.request.sessionId,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        runtimeContext: input.request.runtimeContext,
      },
      runId: input.request.runId,
      sequence: nextSequence(),
      reason: 'Model step request was cancelled before it started.',
      createdAt: new Date().toISOString(),
    });
    return;
  }

  try {
    for await (const event of input.modelStepPort.streamModelStep({
      request: input.request,
      runId: input.request.runId,
      stepId: input.request.stepId,
      signal: input.signal,
      nextSequence,
      eventIdFactory,
    })) {
      yield event;
    }
  } catch (error) {
    yield createRunFailedEvent({
      eventId: eventIdFactory(),
      request: {
        requestId: input.request.requestId,
        sessionId: input.request.sessionId,
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        runtimeContext: input.request.runtimeContext,
      },
      runId: input.request.runId,
      sequence: nextSequence(),
      createdAt: new Date().toISOString(),
      error: normalizeRuntimeError(error, {
        source: 'core',
        debugId: input.request.runtimeContext?.debugId ?? `debug:${input.request.requestId}`,
        fallbackMessage: 'Model step streaming failed.',
      }),
    });
  }
}


