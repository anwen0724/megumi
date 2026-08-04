/*
 * Protects formal RuntimeEvent publication, ordering, and consumer isolation.
 */
import { describe, expect, it, vi } from 'vitest';
import { RunResumedEventSchema, type RuntimeEvent } from '@megumi/events';
import { createRuntimeTimeline, reduceRuntimeTimeline } from '@megumi/projections';
import type { ObservabilityService } from '@megumi/observability';
import {
  createRuntimeEventSegment,
  eventSegmentCapacity,
} from '../../../packages/engine/src/run-loop';
import {
  assistantStream,
  collectEvents,
  createEngineFixture,
  enginePolicy,
  retryableFailedStream,
  startedRun,
  startRequest,
} from './engine-test-fixtures';

describe('Engine RuntimeEvents', () => {
  it('requires the real RunApproval identity for run.resumed', () => {
    const envelope = {
      eventId: 'event:1',
      schemaVersion: 1,
      eventType: 'run.resumed',
      runId: 'run:1',
      sessionId: 'session:1',
      sequence: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      source: 'approval',
      visibility: 'system',
      persist: 'transient',
    };

    expect(RunResumedEventSchema.safeParse({
      ...envelope,
      payload: { runApprovalId: 'approval:1' },
    }).success).toBe(true);
    expect(RunResumedEventSchema.safeParse({
      ...envelope,
      payload: { resumeRequestId: 'fabricated:1' },
    }).success).toBe(false);
  });

  it('publishes contiguous per-Run sequence numbers through queue and publisher', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
    });

    const started = await startedRun(fixture);
    const events = await collectEvents(started.events);

    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1),
    );
    expect(fixture.published.map((event) => event.eventId)).toEqual(
      events.map((event) => event.eventId),
    );
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      'run.started',
      'model_call.started',
      'model_call.completed',
      'run.completed',
    ]));
  });

  it('does not fail a Run when the optional live publisher throws', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
      eventPublisher: {
        publish: () => {
          throw new Error('projection unavailable');
        },
      },
    });

    const started = await startedRun(fixture);
    const events = await collectEvents(started.events);

    expect(events.at(-1)?.eventType).toBe('run.completed');
    expect(fixture.writes.at(-1)).toBe('assistant:completed');
  });

  it('ignores an asynchronous publisher rejection without delaying the Run', async () => {
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
      eventPublisher: {
        publish: async () => {
          throw new Error('async projection unavailable');
        },
      },
    });

    const started = await startedRun(fixture);
    expect((await collectEvents(started.events)).at(-1)?.eventType).toBe('run.completed');
  });

  it('emits projection reset between failed-attempt deltas and the successful retry', async () => {
    const fixture = createEngineFixture({
      streams: [
        retryableFailedStream('discard me'),
        assistantStream('keep me'),
      ],
      policy: { maxModelCallAttempts: 2 },
    });

    const started = await startedRun(fixture);
    const events = await collectEvents(started.events);
    const resetIndex = events.findIndex(
      (event) => event.eventType === 'model_call.projection_reset',
    );
    const successfulDeltaIndex = events.findIndex(
      (event) => event.eventType === 'model_call.text_delta'
        && (event.payload as { delta?: string }).delta === 'keep me',
    );
    expect(resetIndex).toBeGreaterThan(0);
    expect(resetIndex).toBeLessThan(successfulDeltaIndex);

    let timeline = createRuntimeTimeline();
    for (const event of events.slice(0, resetIndex + 1)) {
      timeline = reduceRuntimeTimeline({ timeline, event });
    }
    expect(JSON.stringify(timeline)).not.toContain('discard me');
    for (const event of events.slice(resetIndex + 1)) {
      timeline = reduceRuntimeTimeline({ timeline, event });
    }
    expect(JSON.stringify(timeline)).toContain('keep me');
    expect(JSON.stringify(timeline)).not.toContain('discard me');
  });

  it('keeps control and terminal events when a slow consumer fills the delta slots', async () => {
    const segment = createRuntimeEventSegment(4);
    const event = (
      eventType: RuntimeEvent['eventType'],
      sequence: number,
      payload: object,
    ): RuntimeEvent => ({
      eventId: `event:${sequence}`,
      schemaVersion: 1,
      eventType,
      runId: 'run:1',
      sessionId: 'session:1',
      sequence,
      createdAt: '2026-07-31T00:00:00.000Z',
      source: 'core',
      visibility: 'system',
      persist: 'transient',
      payload,
    });
    segment.push(event('run.started', 1, {
      runKind: 'agent',
      providerId: 'provider:test',
      modelId: 'model:test',
    }));
    segment.push(event('model_call.text_delta', 2, {
      modelCallId: 'model-call:1',
      delta: 'drop one',
    }));
    segment.push(event('model_call.text_delta', 3, {
      modelCallId: 'model-call:1',
      delta: 'drop two',
    }));
    segment.push(event('run.cancel.requested', 4, {
      cancelRequestId: 'cancel:1',
      requestedBy: 'user',
      reason: 'user_cancelled',
      scope: 'run',
    }));
    segment.push(event('run.cancelling', 5, { cancelRequestId: 'cancel:1' }));
    segment.push(event('run.cancelled', 6, { reason: 'user_cancelled' }));
    segment.close();

    const events = await collectEvents(segment.events);
    expect(events.map((item) => item.eventType)).toEqual([
      'run.started',
      'run.cancel.requested',
      'run.cancelling',
      'run.cancelled',
    ]);
    expect(eventSegmentCapacity({
      policy: enginePolicy,
    } as Parameters<typeof eventSegmentCapacity>[0])).toBeGreaterThanOrEqual(
      32 + enginePolicy.maxToolCallsPerRun * 5,
    );
  });

  it('does not let Observability start or finish failures change the Run result', async () => {
    const startFailure = createEngineFixture({
      streams: [assistantStream('answer')],
      observability: {
        startTrace: () => {
          throw new Error('trace unavailable');
        },
      } as unknown as ObservabilityService,
    });
    const first = await startedRun(startFailure);
    expect((await collectEvents(first.events)).at(-1)?.eventType).toBe('run.completed');

    const finishFailure = createEngineFixture({
      streams: [assistantStream('answer')],
      observability: {
        startTrace: () => ({
          traceId: 'trace:1',
          name: 'agent_run',
          startedAtMs: 0,
          context: { traceId: 'trace:1' },
        }),
        runInTraceContext: (_trace: unknown, operation: () => unknown) => operation(),
        startSpan: () => ({
          traceId: 'trace:1',
          spanId: 'span:1',
          name: 'agent_run',
          startedAtMs: 0,
          context: { traceId: 'trace:1', spanId: 'span:1' },
        }),
        endSpan: () => {
          throw new Error('span finish unavailable');
        },
      } as unknown as ObservabilityService,
    });
    const second = await startedRun(finishFailure, {
      ...startRequest,
      requestId: 'request:2',
    });
    expect((await collectEvents(second.events)).at(-1)?.eventType).toBe('run.completed');
  });

  it('runs work inside the root Span and records correlated operation diagnostics', async () => {
    const runInSpanContext = vi.fn((_span, operation: () => unknown) => operation());
    const startSpan = vi.fn((request: { name: string }) => ({
      traceId: 'trace:1',
      spanId: `span:${request.name}:${startSpan.mock.calls.length}`,
      name: request.name,
      startedAtMs: 0,
      context: { traceId: 'trace:1' },
    }));
    const recordLog = vi.fn();
    const recordMeasurement = vi.fn();
    const observability = {
      startTrace: () => ({
        traceId: 'trace:1',
        name: 'agent_run',
        startedAtMs: 0,
        context: { traceId: 'trace:1' },
      }),
      runInTraceContext: (_trace: unknown, operation: () => unknown) => operation(),
      startSpan,
      runInSpanContext,
      endSpan: vi.fn(),
      endTrace: vi.fn(),
      recordLog,
      recordMeasurement,
    } as unknown as ObservabilityService;
    const fixture = createEngineFixture({
      streams: [assistantStream('answer')],
      observability,
    });

    const started = await startedRun(fixture);
    expect((await collectEvents(started.events)).at(-1)?.eventType).toBe('run.completed');

    expect(runInSpanContext).toHaveBeenCalled();
    expect(startSpan.mock.calls.map(([request]) => request.name)).toEqual(
      expect.arrayContaining(['agent_run', 'context.build', 'model.call']),
    );
    expect(recordLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'model.call.attempt.started',
      correlation: expect.objectContaining({
        traceId: 'trace:1',
        runId: 'run:1',
        sessionId: 'session:1',
      }),
    }));
    expect(recordMeasurement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'model.call.attempt',
      unit: 'count',
    }));
  });
});
