// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createModelMessageObservation,
  createModelStepInputPreview,
  isModelMessageAction,
  isModelStep,
} from '@megumi/core/run-runtime/model-step';

describe('run model step foundation', () => {
  it('describes model step input without provider execution', () => {
    expect(createModelStepInputPreview({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      goal: 'Answer',
    })).toEqual({
      stepKind: 'model',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      goal: 'Answer',
    });
  });

  it('identifies model step and emit_message action boundaries', () => {
    expect(isModelStep({ kind: 'model' })).toBe(true);
    expect(isModelStep({ kind: 'tool' })).toBe(false);
    expect(isModelMessageAction({ kind: 'emit_message' })).toBe(true);
    expect(isModelMessageAction({ kind: 'call_tool' })).toBe(false);
  });

  it('creates a redaction-safe model message observation shell', () => {
    expect(createModelMessageObservation({
      observationId: 'observation-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      receivedAt: '2026-05-17T00:00:00.000Z',
    })).toEqual({
      observationId: 'observation-1',
      runId: 'run-1',
      stepId: 'step-1',
      actionId: 'action-1',
      source: 'runtime',
      kind: 'message_emitted',
      receivedAt: '2026-05-17T00:00:00.000Z',
      summary: 'Model step emitted a message.',
    });
  });
});

