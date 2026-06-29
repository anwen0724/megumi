// Maps runtime events into the legacy model_steps persistence table during migration.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeError, RuntimeEvent } from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import type { ModelStepRecord } from './repos/model-step.repo';

export interface LegacyModelStepEventRepository {
  getModelStep(modelStepId: string): ModelStepRecord | undefined;
  saveModelStep(modelStep: ModelStepRecord): ModelStepRecord;
}

export interface PersistLegacyModelStepRecordFromEventInput {
  repository: LegacyModelStepEventRepository;
  request: ModelStepRuntimeRequest;
  event: RuntimeEvent;
  fallbackStepId: string;
  overrides?: {
    status?: RunStep['status'];
    completedAt?: string;
    error?: RuntimeError;
  };
}

export function persistLegacyModelStepRecordFromEvent(
  input: PersistLegacyModelStepRecordFromEventInput,
): ModelStepRecord | undefined {
  if (!isLegacyModelStepPersistenceEvent(input.event)) {
    return undefined;
  }

  const modelStepId = getModelStepId(input.event.payload) ?? input.request.modelStepId;
  if (!modelStepId) {
    return undefined;
  }

  const existing = input.repository.getModelStep(modelStepId);
  return input.repository.saveModelStep({
    modelStepId,
    runId: input.request.runId,
    stepId: input.event.stepId ?? input.request.stepId ?? existing?.stepId ?? input.fallbackStepId,
    providerId: input.request.providerId,
    modelId: input.request.modelId,
    status: input.overrides?.status ?? existing?.status ?? 'running',
    startedAt: existing?.startedAt ?? input.event.createdAt,
    ...(input.overrides?.completedAt ?? existing?.completedAt ? {
      completedAt: input.overrides?.completedAt ?? existing?.completedAt,
    } : {}),
    ...(input.overrides?.error ?? existing?.error ? { error: input.overrides?.error ?? existing?.error } : {}),
    metadata: {
      ...(existing?.metadata ?? {}),
      sourceEventType: input.event.eventType,
    },
  });
}

function isLegacyModelStepPersistenceEvent(event: RuntimeEvent): boolean {
  return event.eventType === 'model.step.started'
    || event.eventType === 'model.step.completed'
    || event.eventType === 'tool.call.created';
}

function getModelStepId(payload: RuntimeEvent['payload']): string | undefined {
  if (!isObjectRecord(payload)) {
    return undefined;
  }

  return typeof payload.modelStepId === 'string' ? payload.modelStepId : undefined;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
