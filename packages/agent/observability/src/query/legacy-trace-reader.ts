/*
 * Reads the previous observability.jsonl format during its bounded migration window.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { DiagnosticJsonValueSchema } from '../diagnostic-value';
import type { ObservabilityStorage } from '../persistence/observability-storage';

const LEGACY_READ_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const LEGACY_FILE_NAME = /^observability\.jsonl(?:\.(\d+))?$/;

const LegacyCorrelationSchema = z.object({
  traceId: z.string().min(1),
  executionId: z.string().optional(),
}).passthrough();

const LegacyRecordSchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().min(1),
  timestamp: z.string().datetime({ offset: true }),
  sequence: z.number().int().nonnegative(),
  correlation: LegacyCorrelationSchema,
  attributes: DiagnosticJsonValueSchema,
  type: z.string().min(1),
  status: z.enum(['ok', 'error', 'cancelled']).optional(),
}).passthrough();

export type LegacyObservabilityRecord = z.infer<typeof LegacyRecordSchema>;

export interface LegacyDiagnostic {
  readonly kind: 'legacy diagnostic';
  readonly traceId: string;
  readonly executionId?: string;
  readonly status: 'ok' | 'error' | 'cancelled' | 'incomplete';
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly contentAvailable: false;
  readonly records: readonly LegacyObservabilityRecord[];
}

export interface LegacyTraceReader {
  /** Lists legacy diagnostic groups that are still inside the migration window. */
  list(): Promise<readonly LegacyDiagnostic[]>;
}

export interface CreateLegacyTraceReaderOptions {
  readonly directoryPath: string;
  readonly storage: ObservabilityStorage;
  readonly now?: () => Date;
  readonly retentionMs?: number;
}

/** Creates a read-only adapter for the previous JSONL diagnostic format. */
export function createLegacyTraceReader(options: CreateLegacyTraceReaderOptions): LegacyTraceReader {
  const now = options.now ?? (() => new Date());
  const retentionMs = options.retentionMs ?? LEGACY_READ_WINDOW_MS;

  return {
    async list(): Promise<readonly LegacyDiagnostic[]> {
      const cutoff = now().getTime() - retentionMs;
      const entries = await options.storage.listEntries(options.directoryPath);
      const files = entries
        .filter((entry) => entry.kind === 'file' && LEGACY_FILE_NAME.test(entry.name))
        .filter((entry) => entry.modifiedAtMs >= cutoff)
        .sort(compareLegacyFiles);
      const records: LegacyObservabilityRecord[] = [];

      for (const file of files) {
        const filePath = join(options.directoryPath, file.name);
        let text: string;
        try {
          text = await options.storage.readText(filePath);
        } catch {
          continue;
        }

        for (const line of text.split(/\r?\n/)) {
          const record = parseLegacyRecord(line);
          if (record) records.push(record);
        }
      }

      return projectLegacyDiagnostics(records);
    },
  };
}

function parseLegacyRecord(line: string): LegacyObservabilityRecord | undefined {
  if (line.trim().length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    const result = LegacyRecordSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function projectLegacyDiagnostics(
  records: readonly LegacyObservabilityRecord[],
): readonly LegacyDiagnostic[] {
  const grouped = new Map<string, LegacyObservabilityRecord[]>();
  for (const record of records) {
    const traceRecords = grouped.get(record.correlation.traceId) ?? [];
    traceRecords.push(record);
    grouped.set(record.correlation.traceId, traceRecords);
  }

  return [...grouped.entries()]
    .map(([traceId, traceRecords]) => projectLegacyDiagnostic(traceId, traceRecords))
    .sort((left, right) => compareOptionalTimestamp(right.startedAt, left.startedAt));
}

function projectLegacyDiagnostic(
  traceId: string,
  records: LegacyObservabilityRecord[],
): LegacyDiagnostic {
  records.sort(compareLegacyRecords);
  const started = records.find((record) => record.type === 'trace.started');
  const ended = [...records].reverse().find((record) => record.type === 'trace.ended');
  const executionId = records.find(
    (record) => record.correlation.executionId,
  )?.correlation.executionId;
  return {
    kind: 'legacy diagnostic',
    traceId,
    ...(executionId ? { executionId } : {}),
    status: ended?.status ?? 'incomplete',
    ...(started ? { startedAt: started.timestamp } : {}),
    ...(ended ? { endedAt: ended.timestamp } : {}),
    contentAvailable: false,
    records,
  };
}

function compareLegacyFiles(
  left: { readonly name: string },
  right: { readonly name: string },
): number {
  const leftSegment = Number(LEGACY_FILE_NAME.exec(left.name)?.[1] ?? 0);
  const rightSegment = Number(LEGACY_FILE_NAME.exec(right.name)?.[1] ?? 0);
  return leftSegment - rightSegment;
}

function compareLegacyRecords(
  left: LegacyObservabilityRecord,
  right: LegacyObservabilityRecord,
): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  return timestampOrder === 0 ? left.sequence - right.sequence : timestampOrder;
}

function compareOptionalTimestamp(left?: string, right?: string): number {
  return (left ?? '').localeCompare(right ?? '');
}
