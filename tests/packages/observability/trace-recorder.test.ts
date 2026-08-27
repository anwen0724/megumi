// @vitest-environment node
/* Verifies callback-scoped Trace behavior through the Recorder boundary. */
import { describe, expect, it, vi } from 'vitest';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';
import {
  TraceJournalRecordSchema,
  type TraceJournalRecord,
} from '../../../packages/agent/observability/src/persistence/trace-journal-record';

describe('Trace recorder', () => {
  it('executes one operation once and records its complete Trace lifecycle', async () => {
    const records: TraceJournalRecord[] = [];
    const operation = vi.fn(async () => 'done');
    const observability = createTraceRecorder({
      enqueue: (record) => records.push(record),
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      createId: (() => {
        let value = 0;
        return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
      })(),
    });

    await expect(observability.withTrace(
      { kind: 'conversation', correlation: { requestId: 'request-1' } },
      operation,
    )).resolves.toBe('done');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(records.map((record) => record.type)).toEqual([
      'trace.started',
      'trace.ended',
    ]);
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(records[0]).toMatchObject({
      traceKind: 'conversation',
      correlation: { requestId: 'request-1' },
    });
    expect(records[1]).toMatchObject({
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    });
  });

  it('preserves one parent for overlapping sibling Spans and one Trace-local sequence', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);

    await observability.withTrace({ kind: 'conversation' }, async () => {
      await observability.withSpan({ name: 'agent.execution' }, async () => {
        await Promise.all([
          observability.withSpan({ name: 'tool.call' }, async () => Promise.resolve()),
          observability.withSpan({ name: 'tool.call' }, async () => Promise.resolve()),
        ]);
      });
    });

    const started = records.filter((record) => record.type === 'span.started');
    const root = started.find((record) => record.name === 'agent.execution');
    const tools = started.filter((record) => record.name === 'tool.call');
    expect(root).toBeDefined();
    expect(tools).toHaveLength(2);
    expect(tools.map((record) => record.parentSpanId)).toEqual([
      root?.spanId,
      root?.spanId,
    ]);
    expect(records.map((record) => record.sequence)).toEqual(
      Array.from({ length: records.length }, (_, index) => index + 1),
    );
  });

  it('classifies fulfilled business failures without changing their result', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);
    const businessResult = {
      status: 'failed' as const,
      failure: { code: 'model_unavailable', message: 'No model.' },
    };

    await expect(observability.withTrace({
      kind: 'daily_recommendation',
      classifyResult: (result) => ({
        outcome: {
          status: 'error',
          code: result.failure.code,
          message: result.failure.message,
        },
        correlation: { batchId: 'batch-1' },
      }),
    }, async () => businessResult)).resolves.toBe(businessResult);

    expect(records.at(-1)).toMatchObject({
      type: 'trace.ended',
      outcome: { status: 'error', code: 'model_unavailable' },
      correlation: { batchId: 'batch-1' },
    });
  });

  it('marks classifier failure unavailable and preserves the fulfilled value', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);

    await expect(observability.withTrace({
      kind: 'conversation',
      classifyResult: () => { throw new Error('classifier failed'); },
    }, async () => 42)).resolves.toBe(42);

    expect(records.at(-1)).toMatchObject({
      type: 'trace.ended',
      outcome: { status: 'unavailable', reason: 'classifier_failed' },
    });
  });

  it('rethrows the original operation error after recording its outcome', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);
    const failure = Object.assign(new Error('Provider failed.'), { code: 'provider_failed' });

    await expect(observability.withTrace(
      { kind: 'conversation' },
      async () => { throw failure; },
    )).rejects.toBe(failure);

    expect(records.at(-1)).toMatchObject({
      type: 'trace.ended',
      outcome: {
        status: 'error',
        code: 'provider_failed',
        message: 'Provider failed.',
      },
    });
  });

  it('records closed Events only on the current Span', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);

    await observability.withTrace({ kind: 'daily_recommendation' }, async () => {
      observability.recordEvent({
        type: 'discovery.retry.scheduled',
        currentAttempt: 1,
        nextAttempt: 2,
        reasonCode: 'retryable_failure',
      });
      await observability.withSpan({ name: 'discovery.attempt' }, async () => {
        observability.recordEvent({
          type: 'discovery.retry.scheduled',
          currentAttempt: 1,
          nextAttempt: 2,
          reasonCode: 'retryable_failure',
        });
      });
    });

    const events = records.filter((record) => record.type === 'span.event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: { type: 'discovery.retry.scheduled', nextAttempt: 2 },
    });
  });

  it('links a duplicate Trace to the active Trace selected by correlation', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = createRecorder(records);

    await observability.withTrace({
      kind: 'conversation',
      correlation: { requestId: 'request-duplicate', executionId: 'execution-1' },
    }, async () => observability.withTrace({
      kind: 'conversation',
      correlation: { requestId: 'request-duplicate', executionId: 'execution-1' },
    }, async () => {
      observability.linkTrace({
        kind: 'duplicate',
        target: {
          by: 'correlation',
          traceKind: 'conversation',
          correlation: { requestId: 'request-duplicate', executionId: 'execution-1' },
          state: 'active',
        },
      });
    }));

    const starts = records.filter((record) => record.type === 'trace.started');
    const link = records.find((record) => record.type === 'trace.linked');
    expect(link).toMatchObject({
      linkKind: 'duplicate',
      traceId: starts[1]?.traceId,
      targetTraceId: starts[0]?.traceId,
    });
  });

  it('rejects unknown Journal fields and non-positive sequence values', () => {
    expect(TraceJournalRecordSchema.safeParse({
      schemaVersion: 1,
      type: 'trace.started',
      recordId: '00000000-0000-4000-8000-000000000001',
      traceId: '00000000-0000-4000-8000-000000000002',
      sequence: 0,
      timestamp: '2026-08-26T00:00:00.000Z',
      traceKind: 'conversation',
      correlation: {},
      unexpected: true,
    }).success).toBe(false);
  });
});

function createRecorder(records: TraceJournalRecord[]) {
  let value = 0;
  return createTraceRecorder({
    enqueue: (record) => records.push(record),
    now: () => new Date('2026-08-26T00:00:00.000Z'),
    createId: () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`,
  });
}
