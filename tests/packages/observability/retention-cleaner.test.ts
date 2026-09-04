// @vitest-environment node
/* Verifies age, capacity, active-segment, complete-Trace, Content GC, and cleanup health rules. */
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createObservabilityHealth } from '../../../packages/agent/observability/src/runtime/observability-health';
import { encodeRuntimeLogEntry } from '../../../packages/agent/observability/src/runtime/runtime-log-entry';
import {
  createRetentionCleaner,
  type RetentionIndexPruner,
} from '../../../packages/agent/observability/src/persistence/retention-cleaner';
import {
  encodeTraceJournalRecord,
  type TraceJournalRecord,
} from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { ObservabilityMemoryStorage } from './observability-memory-storage';

describe('Retention cleaner', () => {
  it('checks bytes without reading or deleting expired history when the write fits', async () => {
    const storage = new ObservabilityMemoryStorage();
    const path = tracePath('2026-07-01', 1);
    seedTraceSegment(storage, path, completeTrace(
      '00000000-0000-4000-8000-000000000010', '2026-07-01T00:00:00.000Z',
    ));
    const readText = vi.spyOn(storage, 'readText');
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability', storage,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(await cleaner.ensureCapacity(100)).toBe(true);
    expect(readText).not.toHaveBeenCalled();
    expect(storage.filePaths()).toContain(path);
    await cleaner.maintain();
    expect(storage.filePaths()).not.toContain(path);
  });

  it('cleans complete cross-file historical Trace kinds without validating business values', async () => {
    const storage = new ObservabilityMemoryStorage();
    const firstPath = tracePath('2026-07-01', 1);
    const secondPath = tracePath('2026-07-01', 2);
    const traceId = '00000000-0000-4000-8000-000000000010';
    storage.seedText(firstPath, JSON.stringify({
      ...traceStarted(traceId, 1, '2026-07-01T00:00:00.000Z'),
      traceKind: 'daily_recommendation', historicalAttribute: true,
    }));
    seedTraceSegment(storage, secondPath, [traceEnded(traceId, 2, '2026-07-01T00:00:01.000Z')]);
    const health = createObservabilityHealth();
    const write = vi.fn();
    const active = new Set([secondPath]);
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability', storage, health, runtimeLogger: { write },
      activeFilePaths: () => active,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect((await cleaner.maintain()).deletedFiles).toEqual([]);
    active.clear();
    expect((await cleaner.maintain()).deletedFiles).toEqual([firstPath, secondPath]);
    expect(health.snapshot().retentionCleanupFailures).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves stored Content referenced by historical business checkpoints during GC', async () => {
    const storage = new ObservabilityMemoryStorage();
    const bytes = new TextEncoder().encode('historical body');
    const contentId = sha256(bytes);
    seedBlob(storage, contentId, bytes);
    const orphanId = sha256(new TextEncoder().encode('orphan'));
    seedBlob(storage, orphanId, new TextEncoder().encode('orphan'));
    const traceId = '00000000-0000-4000-8000-000000000010';
    const path = tracePath('2026-09-01', 1);
    const original = [
      { ...traceStarted(traceId, 1, '2026-09-01T00:00:00.000Z'), traceKind: 'daily_recommendation' },
      { ...storedContent(traceId, 2, contentId, bytes.length, '2026-09-01T00:00:01.000Z'), kind: 'old.checkpoint' },
      traceEnded(traceId, 3, '2026-09-01T00:00:02.000Z'),
    ].map((record) => JSON.stringify(record)).join('\n');
    storage.seedText(path, original);
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability', storage,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });
    try {
      await cleaner.startup();
      expect(storage.filePaths()).toContain(blobPath(contentId));
      expect(storage.filePaths()).not.toContain(blobPath(orphanId));
      expect(await storage.readText(path)).toBe(original);
    } finally {
      await cleaner.shutdown();
    }
  });

  it.each([
    ['broken JSON', '{"secret":"do-not-log",', 1],
    ['unknown version', JSON.stringify({ schemaVersion: 2 }), 2],
    ['unknown version in v1 file', JSON.stringify({
      ...traceEnded('00000000-0000-4000-8000-000000000010', 2, '2026-07-01T00:00:00.000Z'),
      schemaVersion: 2,
    }), 1],
    ['missing identity', JSON.stringify({ schemaVersion: 1, type: 'trace.ended' }), 1],
    ['unknown record type', JSON.stringify({ schemaVersion: 1, type: 'future.event' }), 1],
    ['invalid content reference', JSON.stringify({
      ...traceStarted('00000000-0000-4000-8000-000000000010', 1, '2026-07-01T00:00:00.000Z'),
      type: 'content.recorded', content: { mode: 'stored', contentId: 'invalid' },
    }), 1],
    ['unknown content storage mode', JSON.stringify({
      ...traceStarted('00000000-0000-4000-8000-000000000010', 1, '2026-07-01T00:00:00.000Z'),
      type: 'content.recorded', content: { mode: 'future_storage' },
    }), 1],
  ])('retains uncertain history and blobs, with safe location diagnostics: %s', async (_name, invalidLine, version) => {
    const storage = new ObservabilityMemoryStorage();
    const path = tracePath('2026-07-01', 1).replace('trace-v1-', `trace-v${version}-`);
    storage.seedText(path, `\n${invalidLine}\n`);
    const completePath = tracePath('2026-07-01', 2);
    seedTraceSegment(storage, completePath, completeTrace(
      '00000000-0000-4000-8000-000000000010', '2026-07-01T00:00:00.000Z',
    ));
    const bytes = new TextEncoder().encode('possibly referenced');
    const contentId = sha256(bytes);
    seedBlob(storage, contentId, bytes);
    const write = vi.fn();
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability', storage, runtimeLogger: { write },
      now: () => new Date('2026-09-04T00:00:00.000Z'),
      maxTotalBytes: 1,
    });
    try {
      await cleaner.startup();
      expect(storage.filePaths()).toEqual(expect.arrayContaining([path, completePath, blobPath(contentId)]));
      expect(write).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          path: relative('observability', path), lineNumber: 2, reason: expect.any(String),
        }),
      }));
      expect(JSON.stringify(write.mock.calls)).not.toContain('do-not-log');
      write.mockClear();
      expect(await cleaner.ensureCapacity(10)).toBe(false);
      expect(write).not.toHaveBeenCalled();
    } finally {
      await cleaner.shutdown();
    }
  });

  it('deletes only old complete inactive segments and GCs only unreferenced Content', async () => {
    const storage = new ObservabilityMemoryStorage();
    const oldOnlyBytes = new TextEncoder().encode('old-only');
    const oldOnlyId = sha256(oldOnlyBytes);
    const sharedBytes = new TextEncoder().encode('shared');
    const sharedId = sha256(sharedBytes);
    const oldPath = tracePath('2026-07-01', 1);
    const newPath = tracePath('2026-08-20', 1);
    const incompletePath = tracePath('2026-07-02', 1);
    const activePath = tracePath('2026-07-03', 1);
    const oldRuntimePath = runtimePath('2026-07-01', 1);
    seedTraceSegment(storage, oldPath, [
      traceStarted('00000000-0000-4000-8000-000000000010', 1, '2026-07-01T00:00:00.000Z'),
      storedContent('00000000-0000-4000-8000-000000000010', 2, oldOnlyId, oldOnlyBytes.byteLength, '2026-07-01T00:00:01.000Z'),
      storedContent('00000000-0000-4000-8000-000000000010', 3, sharedId, sharedBytes.byteLength, '2026-07-01T00:00:02.000Z'),
      traceEnded('00000000-0000-4000-8000-000000000010', 4, '2026-07-01T00:00:03.000Z'),
    ]);
    seedTraceSegment(storage, newPath, [
      traceStarted('00000000-0000-4000-8000-000000000020', 1, '2026-08-20T00:00:00.000Z'),
      storedContent('00000000-0000-4000-8000-000000000020', 2, sharedId, sharedBytes.byteLength, '2026-08-20T00:00:01.000Z'),
      traceEnded('00000000-0000-4000-8000-000000000020', 3, '2026-08-20T00:00:02.000Z'),
    ]);
    seedTraceSegment(storage, incompletePath, [
      traceStarted('00000000-0000-4000-8000-000000000030', 1, '2026-07-02T00:00:00.000Z'),
    ]);
    seedTraceSegment(storage, activePath, [
      traceStarted('00000000-0000-4000-8000-000000000040', 1, '2026-07-03T00:00:00.000Z'),
      traceEnded('00000000-0000-4000-8000-000000000040', 2, '2026-07-03T00:00:01.000Z'),
    ]);
    storage.seedText(oldRuntimePath, `${encodeRuntimeLogEntry({
      schemaVersion: 1,
      recordId: '00000000-0000-4000-8000-000000000099',
      timestamp: '2026-07-01T00:00:00.000Z',
      level: 'info',
      module: 'desktop',
      code: 'desktop_started',
      message: 'Desktop started.',
    })}\n`);
    seedBlob(storage, oldOnlyId, oldOnlyBytes);
    seedBlob(storage, sharedId, sharedBytes);
    const prune = vi.fn<RetentionIndexPruner['prune']>(async () => undefined);
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability',
      storage,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      activeFilePaths: () => new Set([activePath]),
      index: { prune },
    });

    const result = await cleaner.maintain();

    expect(result.capacityAvailable).toBe(true);
    expect(storage.filePaths()).not.toContain(oldPath);
    expect(storage.filePaths()).not.toContain(oldRuntimePath);
    expect(storage.filePaths()).toContain(newPath);
    expect(storage.filePaths()).toContain(incompletePath);
    expect(storage.filePaths()).toContain(activePath);
    expect(storage.filePaths()).not.toContain(blobPath(oldOnlyId));
    expect(storage.filePaths()).toContain(blobPath(sharedId));
    expect(prune).toHaveBeenCalledWith({
      retainedJournalPaths: expect.arrayContaining([newPath, incompletePath, activePath]),
    });
  });

  it('deletes oldest closed segments before a write but never deletes the active segment', async () => {
    const storage = new ObservabilityMemoryStorage();
    const oldestPath = tracePath('2026-08-20', 1);
    const activePath = tracePath('2026-08-21', 1);
    seedTraceSegment(storage, oldestPath, completeTrace(
      '00000000-0000-4000-8000-000000000050',
      '2026-08-20T00:00:00.000Z',
    ));
    seedTraceSegment(storage, activePath, completeTrace(
      '00000000-0000-4000-8000-000000000060',
      '2026-08-21T00:00:00.000Z',
    ));
    const activeSize = (await storage.stat(activePath))?.size ?? 0;
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability',
      storage,
      now: () => new Date('2026-08-26T00:00:00.000Z'),
      maxTotalBytes: activeSize + 10,
      activeFilePaths: () => new Set([activePath]),
    });

    const first = await cleaner.ensureCapacity(5);
    const second = await cleaner.ensureCapacity(20);

    expect(first).toBe(true);
    expect(storage.filePaths()).not.toContain(oldestPath);
    expect(storage.filePaths()).toContain(activePath);
    expect(second).toBe(false);
  });

  it('cleans startup temporary files and reports exact-path deletion failures to health and Runtime Log', async () => {
    const storage = new ObservabilityMemoryStorage();
    const temporaryPath = join(
      'observability',
      'content',
      'sha256',
      'ab',
      '.ab123.temp.tmp',
    );
    storage.seedBytes(temporaryPath, new Uint8Array([1, 2, 3]));
    storage.failRemove = true;
    const health = createObservabilityHealth();
    const write = vi.fn();
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability',
      storage,
      health,
      runtimeLogger: { write },
    });

    await cleaner.startup();

    expect(storage.filePaths()).toContain(temporaryPath);
    expect(health.snapshot().retentionCleanupFailures).toBe(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      module: 'observability',
      code: 'retention_cleanup_failed',
    }));
  });

  it('removes orphan blobs at startup but protects Content awaiting its Journal reference', async () => {
    const storage = new ObservabilityMemoryStorage();
    const orphanBytes = new TextEncoder().encode('orphan');
    const orphanId = sha256(orphanBytes);
    const inFlightBytes = new TextEncoder().encode('in-flight');
    const inFlightId = sha256(inFlightBytes);
    seedBlob(storage, orphanId, orphanBytes);
    seedBlob(storage, inFlightId, inFlightBytes);
    const cleaner = createRetentionCleaner({
      rootDirectory: 'observability',
      storage,
      protectedContentIds: () => new Set([inFlightId]),
    });

    await cleaner.startup();
    await cleaner.shutdown();

    expect(storage.filePaths()).not.toContain(blobPath(orphanId));
    expect(storage.filePaths()).toContain(blobPath(inFlightId));
  });
});

function tracePath(date: string, segment: number): string {
  return join(
    'observability',
    'traces',
    `trace-v1-${date}-${String(segment).padStart(4, '0')}.jsonl`,
  );
}

function runtimePath(date: string, segment: number): string {
  return join(
    'observability',
    'runtime',
    `runtime-v1-${date}-${String(segment).padStart(4, '0')}.jsonl`,
  );
}

function blobPath(contentId: string): string {
  return join(
    'observability',
    'content',
    'sha256',
    contentId.slice(0, 2),
    `${contentId}.blob`,
  );
}

function seedBlob(
  storage: ObservabilityMemoryStorage,
  contentId: string,
  bytes: Uint8Array,
): void {
  storage.seedBytes(blobPath(contentId), bytes);
}

function seedTraceSegment(
  storage: ObservabilityMemoryStorage,
  filePath: string,
  records: readonly TraceJournalRecord[],
): void {
  storage.seedText(filePath, `${records.map(encodeTraceJournalRecord).join('\n')}\n`);
}

function completeTrace(traceId: string, timestamp: string): TraceJournalRecord[] {
  return [traceStarted(traceId, 1, timestamp), traceEnded(traceId, 2, timestamp)];
}

function traceStarted(
  traceId: string,
  sequence: number,
  timestamp: string,
): TraceJournalRecord {
  return {
    schemaVersion: 1,
    type: 'trace.started',
    recordId: recordId(traceId, sequence),
    traceId,
    sequence,
    timestamp,
    traceKind: 'conversation',
    correlation: {},
  };
}

function traceEnded(
  traceId: string,
  sequence: number,
  timestamp: string,
): TraceJournalRecord {
  return {
    schemaVersion: 1,
    type: 'trace.ended',
    recordId: recordId(traceId, sequence),
    traceId,
    sequence,
    timestamp,
    outcome: { status: 'ok' },
    diagnostics: 'complete',
  };
}

function storedContent(
  traceId: string,
  sequence: number,
  contentId: string,
  byteLength: number,
  timestamp: string,
): TraceJournalRecord {
  return {
    schemaVersion: 1,
    type: 'content.recorded',
    recordId: recordId(traceId, sequence),
    traceId,
    sequence,
    timestamp,
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

function recordId(traceId: string, sequence: number): string {
  return `${traceId.slice(0, -12)}${String(100 + sequence).padStart(12, '0')}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
