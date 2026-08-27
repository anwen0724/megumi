// @vitest-environment node
/* Verifies that diagnostics failures never alter product callback semantics. */
import { describe, expect, it, vi } from 'vitest';
import { composeObservability } from '@megumi/observability';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceJournal } from '../../../packages/agent/observability/src/persistence/trace-journal';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Observability failure isolation', () => {
  it('composes one local runtime whose Writer and Reader share Journal truth', async () => {
    const storage = new ObservabilityMemoryStorage();
    const composed = composeObservability({
      rootDirectory: 'observability',
      storage,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
    });

    await composed.observability.withTrace({
      kind: 'conversation',
      correlation: { requestId: 'request:1' },
    }, async () => 'completed');
    await composed.flush();

    const traces = await composed.queries.listTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      traceKind: 'conversation',
      status: 'ok',
      correlations: [{ requestId: 'request:1' }],
    });
    await expect(composed.shutdown()).resolves.toBeUndefined();
    await expect(composed.shutdown()).resolves.toBeUndefined();
  });

  it('keeps the streaming Reader available when the disposable Index cannot open', async () => {
    const storage = new ObservabilityMemoryStorage();
    const composed = composeObservability({
      rootDirectory: 'observability',
      storage,
      openIndexDatabase: () => { throw new Error('Index unavailable.'); },
    });

    await composed.observability.withTrace({ kind: 'daily_recommendation' }, async () => 'settled');
    await composed.flush();

    await expect(composed.queries.listTraces()).resolves.toHaveLength(1);
    expect(composed.queries.getHealth().indexProjectionFailures).toBe(1);
    await composed.shutdown();
  });

  it('returns the original result and executes once when every record write fails', async () => {
    const operation = vi.fn(async () => ({ status: 'accepted' as const }));
    const observability = createTraceRecorder({
      enqueue: () => { throw new Error('journal unavailable'); },
    });

    await expect(observability.withTrace(
      { kind: 'conversation' },
      operation,
    )).resolves.toEqual({ status: 'accepted' });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('records unavailable content without changing business work when capture fails', async () => {
    const records: TraceJournalRecord[] = [];
    const operation = vi.fn(async () => {
      observability.recordContent({ kind: 'prompt.final', value: 'actual prompt' });
      return 'completed';
    });
    const observability = createTraceRecorder({
      enqueue: (record) => records.push(record),
      capture: () => { throw new Error('capture unavailable'); },
    });

    await expect(observability.withTrace(
      { kind: 'conversation' },
      operation,
    )).resolves.toBe('completed');

    expect(operation).toHaveBeenCalledTimes(1);
    expect(records.find((record) => record.type === 'content.recorded')).toMatchObject({
      content: { mode: 'unavailable', reason: 'serialization_failed' },
    });
  });

  it('returns the business result without waiting for terminal Journal disk flush', async () => {
    let releaseAppend = (): void => undefined;
    const appendGate = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    const storage = new ObservabilityMemoryStorage();
    storage.appendGate = appendGate;
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      drainIntervalMs: 60_000,
    });
    const observability = createTraceRecorder({ enqueue: journal.enqueue });

    await expect(observability.withTrace(
      { kind: 'conversation' },
      async () => 'business-completed',
    )).resolves.toBe('business-completed');
    expect(storage.filePaths()).toEqual([]);

    releaseAppend();
    await journal.shutdown();
    expect(storage.filePaths().some((path) => path.endsWith('.jsonl'))).toBe(true);
  });
});
