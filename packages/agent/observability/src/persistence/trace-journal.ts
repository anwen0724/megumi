/*
 * Coordinates bounded Trace jobs so stored Content is durable before its Journal reference.
 */
import { join } from 'node:path';
import { createContentStore, type ContentStore } from '../content/content-store';
import {
  createObservabilityHealth,
  type ObservabilityHealth,
} from '../runtime/observability-health';
import type { TraceRecordSink } from '../trace/trace-recorder';
import {
  createObservabilityWriteQueue,
  type ObservabilityWritePriority,
} from './observability-write-queue';
import type { ObservabilityStorage } from './observability-storage';
import { createRollingJsonlWriter } from './rolling-jsonl-writer';
import {
  encodeTraceJournalRecord,
  type TraceJournalRecord,
} from './trace-journal-record';
import type { RetentionCleaner } from './retention-cleaner';

export const TRACE_QUEUE_CAPACITY_BYTES = 64 * 1024 * 1024;
export const JOURNAL_SEGMENT_MAX_BYTES = 32 * 1024 * 1024;
export const OBSERVABILITY_DRAIN_INTERVAL_MS = 250;

export interface TraceJournal extends TraceRecordSink {
  /** Waits for accepted diagnostic writes without exposing failures to product code. */
  flush(): Promise<void>;
  /** Flushes accepted writes and then rejects future diagnostic jobs. */
  shutdown(): Promise<void>;
  /** Returns the segment path that retention must never delete. */
  activeFilePath(): string | undefined;
  /** Returns blobs currently between durable Content write and Journal reference. */
  protectedContentIds(): ReadonlySet<string>;
}

export interface CreateTraceJournalOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly contentStore?: ContentStore;
  readonly health?: ObservabilityHealth;
  readonly queueCapacityBytes?: number;
  readonly drainIntervalMs?: number;
  readonly maxSegmentBytes?: number;
  readonly retention?: Pick<RetentionCleaner, 'ensureCapacity' | 'maintain'>;
}

/** Creates the authoritative local Trace Journal write side. */
export function createTraceJournal(options: CreateTraceJournalOptions): TraceJournal {
  const health = options.health ?? createObservabilityHealth();
  const contentStore = options.contentStore ?? createContentStore({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
  });
  const protectedContentIds = new Set<string>();
  const writer = createRollingJsonlWriter({
    storage: options.storage,
    directoryPath: join(options.rootDirectory, 'traces'),
    filePrefix: 'trace',
    schemaVersion: 1,
    maxSegmentBytes: options.maxSegmentBytes ?? JOURNAL_SEGMENT_MAX_BYTES,
    onRotate: async () => {
      await options.retention?.maintain();
    },
  });
  const queue = createObservabilityWriteQueue({
    capacityBytes: options.queueCapacityBytes ?? TRACE_QUEUE_CAPACITY_BYTES,
    drainIntervalMs: options.drainIntervalMs ?? OBSERVABILITY_DRAIN_INTERVAL_MS,
    onDrop: (job) => health.recordDrop(job.priority, job.byteLength),
    onWriteFailure: () => health.recordJournalWriteFailure(),
  });

  return {
    enqueue(record, storedBytes) {
      try {
        const encoded = encodeTraceJournalRecord(record);
        const byteLength = new TextEncoder().encode(`${encoded}\n`).byteLength
          + (storedBytes?.byteLength ?? 0);
        const accepted = queue.enqueue({
          id: record.recordId,
          priority: recordPriority(record),
          byteLength,
          terminal: record.type === 'trace.ended',
          write: () => withProtectedContent(record, protectedContentIds, async () => {
            if (options.retention && !await options.retention.ensureCapacity(byteLength)) {
              if (record.type !== 'content.recorded' || record.content.mode !== 'stored') {
                health.recordDrop(recordPriority(record), byteLength);
                return;
              }
              const unavailable = unavailableContentRecord(record, 'storage_limit');
              const unavailableBytes = new TextEncoder().encode(
                `${encodeTraceJournalRecord(unavailable)}\n`,
              ).byteLength;
              if (!await options.retention.ensureCapacity(unavailableBytes)) {
                health.recordDrop('content', byteLength);
                return;
              }
              await writer.append(
                encodeTraceJournalRecord(unavailable),
                new Date(unavailable.timestamp),
              );
              return;
            }
            const durableRecord = await persistContentBeforeReference(
              record,
              storedBytes,
              contentStore,
              health,
            );
            await writer.append(
              encodeTraceJournalRecord(durableRecord),
              new Date(durableRecord.timestamp),
            );
          }),
        });
        if (accepted) health.observeQueueBytes(queue.snapshot().highWaterBytes);
        return accepted;
      } catch {
        health.recordDrop(recordPriority(record), storedBytes?.byteLength ?? 0);
        return false;
      }
    },
    async flush() {
      const failuresBefore = health.snapshot().journalWriteFailures;
      await queue.flush();
      if (health.snapshot().journalWriteFailures > failuresBefore) {
        health.recordFlushFailure();
      }
    },
    async shutdown() {
      const failuresBefore = health.snapshot().journalWriteFailures;
      await queue.shutdown();
      if (health.snapshot().journalWriteFailures > failuresBefore) {
        health.recordFlushFailure();
      }
    },
    activeFilePath: () => writer.activeFilePath(),
    protectedContentIds: () => new Set(protectedContentIds),
  };
}

/** Protects a newly durable blob from concurrent GC until its Journal job has settled. */
async function withProtectedContent(
  record: TraceJournalRecord,
  protectedContentIds: Set<string>,
  operation: () => Promise<void>,
): Promise<void> {
  const contentId = record.type === 'content.recorded' && record.content.mode === 'stored'
    ? record.content.contentId
    : undefined;
  if (contentId) protectedContentIds.add(contentId);
  try {
    await operation();
  } finally {
    if (contentId) protectedContentIds.delete(contentId);
  }
}

function recordPriority(record: TraceJournalRecord): ObservabilityWritePriority {
  if (record.type === 'content.recorded') return 'content';
  if (record.type === 'span.event') return 'event';
  return 'lifecycle';
}

/** Replaces an uncommitted stored reference with an explicit unavailable diagnostic fact. */
async function persistContentBeforeReference(
  record: TraceJournalRecord,
  storedBytes: Uint8Array | undefined,
  contentStore: ContentStore,
  health: ObservabilityHealth,
): Promise<TraceJournalRecord> {
  if (record.type !== 'content.recorded' || record.content.mode !== 'stored') {
    return record;
  }
  if (!storedBytes) {
    health.recordContentWriteFailure();
    return unavailableContentRecord(record, 'content_store_failed');
  }
  const writeResult = await contentStore.write({
    contentId: record.content.contentId,
    bytes: storedBytes,
  });
  if (writeResult.status === 'failed') {
    health.recordContentWriteFailure();
    return unavailableContentRecord(record, 'content_store_failed');
  }
  return record;
}

function unavailableContentRecord(
  record: Extract<TraceJournalRecord, { readonly type: 'content.recorded' }>,
  reason: 'content_store_failed' | 'storage_limit',
): TraceJournalRecord {
  return {
    ...record,
    content: { mode: 'unavailable', reason },
  };
}
