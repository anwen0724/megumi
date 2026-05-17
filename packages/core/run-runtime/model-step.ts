import type { RunAction, RunObservation, RunStep } from '@megumi/shared/session-run-contracts';
import type { JsonObject } from '@megumi/shared/json';
import type { AiModelStepPort } from '../ports/ai-port';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import { normalizeRuntimeError } from '../runtime-exception';
import {
  createRunCancelledEvent,
  createRunFailedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';

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
  aiPort: AiModelStepPort;
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
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        messages: [],
        createdAt: input.request.createdAt,
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
    for await (const event of input.aiPort.streamModelStep({
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
        providerId: input.request.providerId,
        modelId: input.request.modelId,
        messages: [],
        createdAt: input.request.createdAt,
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
