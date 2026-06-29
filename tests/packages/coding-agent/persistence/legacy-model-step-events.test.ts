import { describe, expect, it } from 'vitest';
import {
  persistLegacyModelStepRecordFromEvent,
  type LegacyModelStepEventRepository,
} from '@megumi/coding-agent/persistence';
import type { ModelStepRecord } from '@megumi/coding-agent/persistence/repos/model-step.repo';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';

function createRepository(): LegacyModelStepEventRepository & { records: Map<string, ModelStepRecord> } {
  const records = new Map<string, ModelStepRecord>();
  return {
    records,
    getModelStep: (modelStepId) => records.get(modelStepId),
    saveModelStep: (modelStep) => {
      records.set(modelStep.modelStepId, modelStep);
      return modelStep;
    },
  };
}

function request(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    sessionId: 'session-1',
    stepId: 'step-1',
    modelStepId: 'model-step-from-request',
    providerId: 'openai-compatible',
    modelId: 'gpt-5',
    inputContext: { contextId: 'context-1', parts: [], trace: [] },
    createdAt: '2026-06-29T00:00:00.000Z',
  } as unknown as ModelStepRuntimeRequest;
}

function runtimeEvent(input: {
  eventType: RuntimeEvent['eventType'];
  stepId?: string;
  payload?: RuntimeEvent['payload'];
  createdAt?: string;
}): RuntimeEvent {
  return {
    eventId: `event:${input.eventType}`,
    eventType: input.eventType,
    schemaVersion: 1,
    runId: 'run-1',
    sessionId: 'session-1',
    ...(input.stepId ? { stepId: input.stepId } : {}),
    sequence: 1,
    createdAt: input.createdAt ?? '2026-06-29T00:00:01.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: input.payload ?? {},
  } as RuntimeEvent;
}

describe('persistLegacyModelStepRecordFromEvent', () => {
  it('creates and updates legacy model step records from model-call runtime events', () => {
    const repository = createRepository();

    persistLegacyModelStepRecordFromEvent({
      repository,
      request: request(),
      event: runtimeEvent({
        eventType: 'model.step.started',
        stepId: 'step-from-event',
        payload: { modelStepId: 'model-step-1' },
      }),
      fallbackStepId: 'fallback-step',
    });

    expect(repository.getModelStep('model-step-1')).toEqual({
      modelStepId: 'model-step-1',
      runId: 'run-1',
      stepId: 'step-from-event',
      providerId: 'openai-compatible',
      modelId: 'gpt-5',
      status: 'running',
      startedAt: '2026-06-29T00:00:01.000Z',
      metadata: { sourceEventType: 'model.step.started' },
    });

    persistLegacyModelStepRecordFromEvent({
      repository,
      request: request(),
      event: runtimeEvent({
        eventType: 'model.step.completed',
        stepId: 'step-from-event',
        payload: { modelStepId: 'model-step-1' },
        createdAt: '2026-06-29T00:00:02.000Z',
      }),
      fallbackStepId: 'fallback-step',
      overrides: {
        status: 'succeeded',
        completedAt: '2026-06-29T00:00:02.000Z',
      },
    });

    expect(repository.getModelStep('model-step-1')).toMatchObject({
      modelStepId: 'model-step-1',
      status: 'succeeded',
      startedAt: '2026-06-29T00:00:01.000Z',
      completedAt: '2026-06-29T00:00:02.000Z',
      metadata: { sourceEventType: 'model.step.completed' },
    });
  });

  it('uses request modelStepId fallback and ignores unrelated events', () => {
    const repository = createRepository();

    persistLegacyModelStepRecordFromEvent({
      repository,
      request: request(),
      event: runtimeEvent({
        eventType: 'assistant.output.delta',
        payload: { delta: 'hello' },
      }),
      fallbackStepId: 'fallback-step',
    });
    expect(repository.records.size).toBe(0);

    persistLegacyModelStepRecordFromEvent({
      repository,
      request: request(),
      event: runtimeEvent({
        eventType: 'tool.call.created',
        payload: {},
      }),
      fallbackStepId: 'fallback-step',
    });

    expect(repository.getModelStep('model-step-from-request')).toMatchObject({
      modelStepId: 'model-step-from-request',
      stepId: 'step-1',
      status: 'running',
      metadata: { sourceEventType: 'tool.call.created' },
    });
  });
});
