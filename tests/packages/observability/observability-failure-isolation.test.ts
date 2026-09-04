// @vitest-environment node
/* Verifies that diagnostics failures never alter product callback semantics. */
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { composeObservability } from '@megumi/observability';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceJournal } from '../../../packages/agent/observability/src/persistence/trace-journal';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Observability failure isolation', () => {
  it.each(['flush', 'shutdown'] as const)('finishes %s despite corrupt history under capacity pressure', async (operation) => {
    const storage = new ObservabilityMemoryStorage();
    const corruptPath = join('observability', 'traces', 'trace-v1-2026-08-01-0001.jsonl');
    storage.seedText(corruptPath, '{broken-json}\n');
    // Simulate an over-capacity directory without allocating gigabytes of test data.
    const listEntries = storage.listEntries.bind(storage);
    vi.spyOn(storage, 'listEntries').mockImplementation(async (directoryPath) => (
      (await listEntries(directoryPath)).map((entry) => (
        entry.name === 'trace-v1-2026-08-01-0001.jsonl'
          ? { ...entry, size: 2 * 1024 * 1024 * 1024 }
          : entry
      ))
    ));
    const readText = storage.readText.bind(storage);
    vi.spyOn(storage, 'readText').mockImplementation(async (filePath) => {
      // Real filesystem reads yield to the event loop; preserve that boundary in this failure replay.
      await new Promise<void>((resolve) => setImmediate(resolve));
      return readText(filePath);
    });
    const composed = composeObservability({ rootDirectory: 'observability', storage });
    composed.runtimeLogger.write({ level: 'info', module: 'desktop', code: 'quit', message: 'Quit requested.' });
    // Bound the observation at the public boundary. Restore storage afterward so a failing regression cannot leak a loop.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        composed[operation]().then(() => 'closed'),
        new Promise<string>((resolve) => { timeout = setTimeout(() => resolve('still-waiting'), 500); }),
      ]);
      expect(outcome).toBe('closed');
      expect(storage.filePaths()).toContain(corruptPath);
      expect(composed.queries.getHealth().retentionCleanupFailures).toBeGreaterThan(0);
    } finally {
      clearTimeout(timeout);
      await storage.removeFile(corruptPath);
      await composed.shutdown();
    }
  });
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

    await composed.observability.withTrace({ kind: 'recommendation' }, async () => 'settled');
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
