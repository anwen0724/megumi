// @vitest-environment node
/* Verifies strict Journal encoding, bounded ordering, rolling files, and Content persistence. */
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeTraceJournalLine,
  encodeTraceJournalRecord,
  type TraceJournalRecord,
} from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createObservabilityWriteQueue } from '../../../packages/agent/observability/src/persistence/observability-write-queue';
import { createRollingJsonlWriter } from '../../../packages/agent/observability/src/persistence/rolling-jsonl-writer';
import {
  createTraceJournal,
  OBSERVABILITY_DRAIN_INTERVAL_MS,
  TRACE_QUEUE_CAPACITY_BYTES,
} from '../../../packages/agent/observability/src/persistence/trace-journal';
import { createObservabilityHealth } from '../../../packages/agent/observability/src/runtime/observability-health';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Trace Journal', () => {
  it('uses the fixed 64 MiB queue and 250 ms background drain policy', () => {
    expect(TRACE_QUEUE_CAPACITY_BYTES).toBe(64 * 1024 * 1024);
    expect(OBSERVABILITY_DRAIN_INTERVAL_MS).toBe(250);
  });
  it('strictly encodes and decodes schema v1 records', () => {
    const record = traceStartedRecord(1);
    const encoded = encodeTraceJournalRecord(record);

    expect(decodeTraceJournalLine(encoded)).toEqual(record);
    expect(() => decodeTraceJournalLine(JSON.stringify({ ...record, schemaVersion: 2 }))).toThrow();
    expect(() => decodeTraceJournalLine(JSON.stringify({ ...record, sequence: 0 }))).toThrow();
    expect(() => decodeTraceJournalLine(JSON.stringify({ ...record, unknown: true }))).toThrow();
  });

  it('round-trips every one of the seven closed Journal record types', () => {
    const records = allJournalRecordTypes();

    expect(records.map((record) => decodeTraceJournalLine(
      encodeTraceJournalRecord(record),
    ))).toEqual(records);
    expect(records.map((record) => record.type)).toEqual([
      'trace.started',
      'trace.linked',
      'span.started',
      'span.event',
      'content.recorded',
      'span.ended',
      'trace.ended',
    ]);
  });

  it('rolls deterministic segment names by size and natural day', async () => {
    const storage = new ObservabilityMemoryStorage();
    const directoryPath = join('observability', 'traces');
    const writer = createRollingJsonlWriter({
      storage,
      directoryPath,
      filePrefix: 'trace',
      schemaVersion: 1,
      maxSegmentBytes: 12,
    });

    await writer.append('12345', new Date('2026-08-26T23:59:00.000Z'));
    await writer.append('abcde', new Date('2026-08-26T23:59:01.000Z'));
    await writer.append('z', new Date('2026-08-26T23:59:02.000Z'));
    await writer.append('next', new Date('2026-08-27T00:00:00.000Z'));

    expect(storage.filePaths()).toEqual([
      join(directoryPath, 'trace-v1-2026-08-26-0001.jsonl'),
      join(directoryPath, 'trace-v1-2026-08-26-0002.jsonl'),
      join(directoryPath, 'trace-v1-2026-08-27-0001.jsonl'),
    ]);
    await expect(storage.readText(join(
      directoryPath,
      'trace-v1-2026-08-26-0001.jsonl',
    ))).resolves.toBe('12345\nabcde\n');
  });

  it('evicts Content before Event without reordering retained jobs', async () => {
    const writes: string[] = [];
    const drops: string[] = [];
    const queue = createObservabilityWriteQueue({
      capacityBytes: 10,
      drainIntervalMs: 60_000,
      onDrop: (job) => drops.push(job.id),
    });

    queue.enqueue(writeJob('content', 'content', 6, writes));
    queue.enqueue(writeJob('event', 'event', 4, writes));
    queue.enqueue(writeJob('lifecycle', 'lifecycle', 6, writes));
    await queue.flush();

    expect(drops).toEqual(['content']);
    expect(writes).toEqual(['event', 'lifecycle']);
    expect(queue.snapshot().highWaterBytes).toBe(10);
  });

  it('persists and verifies stored Content before appending its Journal reference', async () => {
    const storage = new ObservabilityMemoryStorage();
    const bytes = new TextEncoder().encode('large captured context');
    const contentId = sha256(bytes);
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      drainIntervalMs: 60_000,
    });
    const record = contentRecord(contentId, bytes.byteLength);

    journal.enqueue(record, bytes);
    await journal.flush();

    const moveIndex = storage.operations.findIndex((operation) => operation.startsWith('move:'));
    const appendIndex = storage.operations.findIndex((operation) => operation.startsWith('append:'));
    expect(moveIndex).toBeGreaterThanOrEqual(0);
    expect(appendIndex).toBeGreaterThan(moveIndex);
    expect(await readOnlyJournalRecord(storage)).toEqual(record);
  });

  it('preserves Trace-local sequence when one Trace crosses size segments', async () => {
    const storage = new ObservabilityMemoryStorage();
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      maxSegmentBytes: 1,
      drainIntervalMs: 60_000,
    });
    const started = traceStartedRecord(1);
    const ended: TraceJournalRecord = {
      schemaVersion: 1,
      type: 'trace.ended',
      recordId: '00000000-0000-4000-8000-000000000004',
      traceId: started.traceId,
      sequence: 2,
      timestamp: '2026-08-26T00:00:01.000Z',
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    };

    journal.enqueue(started);
    journal.enqueue(ended);
    await journal.flush();

    const paths = storage.filePaths().filter((path) => path.endsWith('.jsonl'));
    expect(paths.map((path) => basename(path))).toEqual([
      'trace-v1-2026-08-26-0001.jsonl',
      'trace-v1-2026-08-26-0002.jsonl',
    ]);
    const records = await Promise.all(paths.map(async (path) => (
      decodeTraceJournalLine((await storage.readText(path)).trim())
    )));
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
  });

  it('writes unavailable instead of a dangling stored reference when Content persistence fails', async () => {
    const storage = new ObservabilityMemoryStorage();
    storage.failMove = true;
    const bytes = new TextEncoder().encode('large captured context');
    const contentId = sha256(bytes);
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      drainIntervalMs: 60_000,
    });

    journal.enqueue(contentRecord(contentId, bytes.byteLength), bytes);
    await journal.flush();

    expect(await readOnlyJournalRecord(storage)).toMatchObject({
      type: 'content.recorded',
      content: { mode: 'unavailable', reason: 'content_store_failed' },
    });
    expect(storage.filePaths().some((path) => path.endsWith(`${contentId}.blob`))).toBe(false);
  });

  it('writes storage_limit when a blob is refused but the smaller Journal record fits', async () => {
    const storage = new ObservabilityMemoryStorage();
    const bytes = new TextEncoder().encode('large captured context');
    const contentId = sha256(bytes);
    let capacityChecks = 0;
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      drainIntervalMs: 60_000,
      retention: {
        ensureCapacity: async () => {
          capacityChecks += 1;
          return capacityChecks > 1;
        },
        maintain: async () => ({ capacityAvailable: true, totalBytes: 0, deletedFiles: [] }),
      },
    });

    journal.enqueue(contentRecord(contentId, bytes.byteLength), bytes);
    await journal.flush();

    expect(await readOnlyJournalRecord(storage)).toMatchObject({
      type: 'content.recorded',
      content: { mode: 'unavailable', reason: 'storage_limit' },
    });
    expect(storage.filePaths().some((path) => path.endsWith(`${contentId}.blob`))).toBe(false);
  });

  it('observes append and explicit flush failures in health without rejecting flush', async () => {
    const storage = new ObservabilityMemoryStorage();
    storage.failAppend = true;
    const health = createObservabilityHealth();
    const journal = createTraceJournal({
      rootDirectory: 'observability',
      storage,
      health,
      drainIntervalMs: 60_000,
    });

    journal.enqueue(traceStartedRecord(1));
    await expect(journal.flush()).resolves.toBeUndefined();

    expect(health.snapshot()).toMatchObject({
      journalWriteFailures: 1,
      flushFailures: 1,
    });
  });
});

function writeJob(
  id: string,
  priority: 'content' | 'event' | 'lifecycle',
  byteLength: number,
  writes: string[],
) {
  return {
    id,
    priority,
    byteLength,
    terminal: false,
    write: async () => { writes.push(id); },
  };
}

function traceStartedRecord(sequence: number): TraceJournalRecord {
  return {
    schemaVersion: 1,
    type: 'trace.started',
    recordId: '00000000-0000-4000-8000-000000000001',
    traceId: '00000000-0000-4000-8000-000000000002',
    sequence,
    timestamp: '2026-08-26T00:00:00.000Z',
    traceKind: 'conversation',
    correlation: {},
  };
}

function allJournalRecordTypes(): TraceJournalRecord[] {
  const traceId = '00000000-0000-4000-8000-000000000002';
  const spanId = '00000000-0000-4000-8000-000000000010';
  const base = (sequence: number) => ({
    schemaVersion: 1 as const,
    recordId: `00000000-0000-4000-8000-${String(100 + sequence).padStart(12, '0')}`,
    traceId,
    sequence,
    timestamp: `2026-08-26T00:00:0${sequence}.000Z`,
  });
  return [
    {
      ...base(1),
      type: 'trace.started',
      traceKind: 'conversation',
      correlation: { requestId: 'request-1' },
    },
    {
      ...base(2),
      type: 'trace.linked',
      linkKind: 'retries',
      targetTraceId: '00000000-0000-4000-8000-000000000099',
    },
    {
      ...base(3),
      type: 'span.started',
      spanId,
      name: 'agent.execution',
      correlation: {},
    },
    {
      ...base(4),
      type: 'span.event',
      spanId,
      event: {
        type: 'discovery.retry.scheduled',
        currentAttempt: 1,
        nextAttempt: 2,
        reasonCode: 'retryable_failure',
      },
    },
    {
      ...base(5),
      type: 'content.recorded',
      spanId,
      kind: 'prompt.final',
      content: {
        mode: 'inline',
        contentId: 'a'.repeat(64),
        mediaType: 'text/plain;charset=utf-8',
        value: 'prompt',
      },
      correlation: {},
    },
    {
      ...base(6),
      type: 'span.ended',
      spanId,
      outcome: { status: 'ok' },
    },
    {
      ...base(7),
      type: 'trace.ended',
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    },
  ];
}

function contentRecord(contentId: string, byteLength: number): TraceJournalRecord {
  return {
    schemaVersion: 1,
    type: 'content.recorded',
    recordId: '00000000-0000-4000-8000-000000000003',
    traceId: '00000000-0000-4000-8000-000000000002',
    sequence: 2,
    timestamp: '2026-08-26T00:00:01.000Z',
    kind: 'context.resolved',
    content: {
      mode: 'stored',
      contentId,
      mediaType: 'text/plain;charset=utf-8',
      byteLength,
    },
    correlation: {},
  };
}

async function readOnlyJournalRecord(
  storage: ObservabilityMemoryStorage,
): Promise<TraceJournalRecord> {
  const journalPath = storage.filePaths().find((path) => path.endsWith('.jsonl'));
  if (!journalPath) throw new Error('Expected a Journal segment.');
  const line = (await storage.readText(journalPath)).trim();
  return decodeTraceJournalLine(line);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
