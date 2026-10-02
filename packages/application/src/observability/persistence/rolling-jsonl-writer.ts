/*
 * Appends one strict JSONL stream to deterministic date-and-size rolling segments.
 */
import { join } from 'node:path';
import type { ObservabilityStorage } from './observability-storage';

export interface RollingJsonlWriter {
  /** Appends one line and rolls before writing when the date or size boundary requires it. */
  append(line: string, timestamp: Date): Promise<void>;
  /** Returns the process-local active segment, which retention must protect. */
  activeFilePath(): string | undefined;
}

export interface CreateRollingJsonlWriterOptions {
  readonly storage: ObservabilityStorage;
  readonly directoryPath: string;
  readonly filePrefix: 'trace' | 'runtime';
  readonly schemaVersion: number;
  readonly maxSegmentBytes: number;
  readonly onRotate?: (closedFilePath: string) => Promise<void>;
}

interface ActiveSegment {
  readonly date: string;
  readonly number: number;
  readonly filePath: string;
  size: number;
}

/** Creates an append-only writer that derives order from parsed names, never directory order. */
export function createRollingJsonlWriter(
  options: CreateRollingJsonlWriterOptions,
): RollingJsonlWriter {
  let active: ActiveSegment | undefined;

  return {
    async append(line, timestamp) {
      const date = timestamp.toISOString().slice(0, 10);
      const encodedLine = `${line}\n`;
      const byteLength = new TextEncoder().encode(encodedLine).byteLength;
      if (!active || active.date !== date) {
        const closedPath = active?.filePath;
        active = await resolveLatestSegment(options, date);
        if (closedPath) await notifyRotation(options, closedPath);
      }
      if (active.size > 0 && active.size + byteLength > options.maxSegmentBytes) {
        const closedPath = active.filePath;
        active = createSegment(options, date, active.number + 1, 0);
        await notifyRotation(options, closedPath);
      }
      await options.storage.ensureDirectory(options.directoryPath);
      await options.storage.appendText(active.filePath, encodedLine);
      active.size += byteLength;
    },

    activeFilePath: () => active?.filePath,
  };
}

/** Selects the highest valid segment number after sorting parsed file names. */
async function resolveLatestSegment(
  options: CreateRollingJsonlWriterOptions,
  date: string,
): Promise<ActiveSegment> {
  await options.storage.ensureDirectory(options.directoryPath);
  const entries = await options.storage.listEntries(options.directoryPath);
  const pattern = new RegExp(
    `^${options.filePrefix}-v${options.schemaVersion}-${date}-(\\d{4})\\.jsonl$`,
  );
  const segments = entries.flatMap((entry) => {
    if (entry.kind !== 'file') return [];
    const match = pattern.exec(entry.name);
    if (!match?.[1]) return [];
    return [{ number: Number(match[1]), size: entry.size }];
  }).sort((left, right) => left.number - right.number);
  const latest = segments.at(-1);
  return createSegment(options, date, latest?.number ?? 1, latest?.size ?? 0);
}

function createSegment(
  options: CreateRollingJsonlWriterOptions,
  date: string,
  number: number,
  size: number,
): ActiveSegment {
  const fileName = `${options.filePrefix}-v${options.schemaVersion}-${date}-${String(number).padStart(4, '0')}.jsonl`;
  return {
    date,
    number,
    filePath: join(options.directoryPath, fileName),
    size,
  };
}

/** Runs retention notification without converting cleanup failure into a write failure. */
async function notifyRotation(
  options: CreateRollingJsonlWriterOptions,
  closedFilePath: string,
): Promise<void> {
  try {
    await options.onRotate?.(closedFilePath);
  } catch {
    // The retention owner reports its own failure and future writes may continue.
  }
}
