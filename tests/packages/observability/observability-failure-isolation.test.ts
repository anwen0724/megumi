// @vitest-environment node
/* Verifies that diagnostics failures never alter product callback semantics. */
import { describe, expect, it, vi } from 'vitest';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';

describe('Observability failure isolation', () => {
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
});
