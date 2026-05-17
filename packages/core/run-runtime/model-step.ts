import type { RunAction, RunObservation, RunStep } from '@megumi/shared/session-run-contracts';
import type { JsonObject } from '@megumi/shared/json';

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
