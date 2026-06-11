// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelStepInputContextFromSources } from '@megumi/context-management';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createModelMessageObservation,
  createModelStepInputPreview,
  isModelMessageAction,
  isModelStep,
  runModelStep,
} from '@megumi/core/agent-runtime';

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
    expect(isModelMessageAction({ kind: 'create_artifact' })).toBe(false);
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

  it('streams provider events through a model step without buffering assistant deltas', async () => {
    const events: RuntimeEvent[] = [];

    for await (const event of runModelStep({
      request: {
        requestId: 'request-1',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        inputContext: buildModelStepInputContextFromSources({
          contextId: 'model-input-context:step-1',
          sessionId: 'session-1',
          runId: 'run-1',
          stepId: 'step-1',
          buildReason: 'test',
          builtAt: '2026-05-17T00:00:00.000Z',
          currentMessage: {
            messageId: 'message-1',
            sessionId: 'session-1',
            role: 'user',
            content: 'Hello',
            status: 'completed',
            createdAt: '2026-05-17T00:00:00.000Z',
          },
        }),
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      aiPort: {
        async *streamModelStep(input) {
          expect(input.request.runId).toBe('run-1');
          expect(input.request.stepId).toBe('step-1');
          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.delta',
            sessionId: input.request.sessionId,
            runId: input.request.runId,
            stepId: input.request.stepId,
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:01.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'transient',
            payload: { delta: 'Hel' },
          };
          yield {
            eventId: input.eventIdFactory(),
            schemaVersion: 1,
            eventType: 'assistant.output.completed',
            sessionId: input.request.sessionId,
            runId: input.request.runId,
            stepId: input.request.stepId,
            sequence: input.nextSequence(),
            createdAt: '2026-05-17T00:00:02.000Z',
            source: 'provider',
            visibility: 'user',
            persist: 'required',
            payload: { content: 'Hello' },
          };
        },
      },
      eventIdFactory: () => `event-${events.length + 1}`,
    })) {
      events.push(event);
    }

    expect(events.map((event) => event.eventType)).toEqual([
      'assistant.output.delta',
      'assistant.output.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });
});



