/*
 * Persists bounded structured application logs separately from the Trace Journal.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { captureContent } from '../content/content-capture';
import {
  redactDiagnosticError,
  redactDiagnosticJsonValue,
  redactDiagnosticText,
} from '../content/secret-redaction';
import type { DiagnosticError } from '../diagnostic-error';
import type { DiagnosticJsonValue } from '../diagnostic-value';
import {
  createObservabilityWriteQueue,
} from '../persistence/observability-write-queue';
import type { ObservabilityStorage } from '../persistence/observability-storage';
import type { RetentionCleaner } from '../persistence/retention-cleaner';
import { createRollingJsonlWriter } from '../persistence/rolling-jsonl-writer';
import type { TraceContext } from '../trace/trace-context';
import type { TraceCorrelation } from '../trace/trace-contract';
import {
  createObservabilityHealth,
  type ObservabilityHealth,
} from './observability-health';
import {
  encodeRuntimeLogEntry,
  RuntimeLogEntrySchema,
  type RuntimeLogEntry,
} from './runtime-log-entry';

export const RUNTIME_QUEUE_CAPACITY_BYTES = 4 * 1024 * 1024;
export const RUNTIME_SEGMENT_MAX_BYTES = 32 * 1024 * 1024;
export const RUNTIME_DRAIN_INTERVAL_MS = 250;

export interface RuntimeLogInput {
  readonly level: RuntimeLogEntry['level'];
  readonly module: string;
  readonly code: string;
  readonly message: string;
  readonly correlation?: TraceCorrelation;
  readonly error?: DiagnosticError;
  readonly data?: DiagnosticJsonValue;
}

export interface RuntimeLogger {
  /** Enqueues one structured application or Module runtime fact without throwing. */
  write(input: RuntimeLogInput): void;
  /** Waits for accepted Runtime Log entries to drain. */
  flush(): Promise<void>;
  /** Flushes accepted entries and stops future logging. */
  shutdown(): Promise<void>;
  /** Returns the Runtime segment that retention must protect. */
  activeFilePath(): string | undefined;
}

export interface CreateRuntimeLoggerOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly context?: TraceContext;
  readonly health?: ObservabilityHealth;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly queueCapacityBytes?: number;
  readonly drainIntervalMs?: number;
  readonly maxSegmentBytes?: number;
  readonly retention?: Pick<RetentionCleaner, 'ensureCapacity' | 'maintain'>;
}

/** Safely converts an untrusted host details value before it enters Runtime Log data. */
export function captureRuntimeLogData(value: unknown): DiagnosticJsonValue {
  const captured = captureContent({
    value,
    mediaType: 'application/json',
    inlineThresholdBytes: Number.MAX_SAFE_INTEGER,
  }).content;
  return captured.mode === 'inline' ? captured.value : null;
}

/** Creates the independent bounded Runtime Log writer. */
export function createRuntimeLogger(options: CreateRuntimeLoggerOptions): RuntimeLogger {
  const health = options.health ?? createObservabilityHealth();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const writer = createRollingJsonlWriter({
    storage: options.storage,
    directoryPath: join(options.rootDirectory, 'runtime'),
    filePrefix: 'runtime',
    schemaVersion: 1,
    maxSegmentBytes: options.maxSegmentBytes ?? RUNTIME_SEGMENT_MAX_BYTES,
    onRotate: async () => {
      await options.retention?.maintain();
    },
  });
  const queue = createObservabilityWriteQueue({
    capacityBytes: options.queueCapacityBytes ?? RUNTIME_QUEUE_CAPACITY_BYTES,
    drainIntervalMs: options.drainIntervalMs ?? RUNTIME_DRAIN_INTERVAL_MS,
    onDrop: (job) => health.recordDrop('runtime', job.byteLength),
    onWriteFailure: () => health.recordJournalWriteFailure(),
  });

  return {
    write(input) {
      try {
        const current = options.context?.current();
        const correlation = mergeCorrelation(current?.correlation, input.correlation);
        const entry = RuntimeLogEntrySchema.parse({
          schemaVersion: 1,
          recordId: createId(),
          timestamp: now().toISOString(),
          level: input.level,
          module: input.module,
          code: input.code,
          message: redactDiagnosticText(input.message).value,
          ...(correlation ? { correlation } : {}),
          ...(current ? { traceId: current.traceId } : {}),
          ...(current?.currentSpanId ? { spanId: current.currentSpanId } : {}),
          ...(input.error ? { error: redactDiagnosticError(input.error) } : {}),
          ...(input.data ? { data: redactDiagnosticJsonValue(input.data) } : {}),
        });
        const encoded = encodeRuntimeLogEntry(entry);
        const byteLength = new TextEncoder().encode(`${encoded}\n`).byteLength;
        const accepted = queue.enqueue({
          id: entry.recordId,
          priority: 'runtime',
          byteLength,
          terminal: false,
          write: async () => {
            if (options.retention && !await options.retention.ensureCapacity(byteLength)) {
              health.recordDrop('runtime', byteLength);
              return;
            }
            await writer.append(encoded, new Date(entry.timestamp));
          },
        });
        if (accepted) health.observeQueueBytes(queue.snapshot().highWaterBytes);
      } catch {
        health.recordDrop('runtime');
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
  };
}

function mergeCorrelation(
  current: TraceCorrelation | undefined,
  supplied: TraceCorrelation | undefined,
): TraceCorrelation | undefined {
  if (!current && !supplied) return undefined;
  return { ...current, ...supplied };
}
