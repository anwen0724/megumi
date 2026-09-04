/*
 * Enforces age and total-size retention without deleting active or diagnostically incomplete data.
 */
import { basename, join, relative } from 'node:path';
import { z } from 'zod';
import type { ObservabilityHealth } from '../runtime/observability-health';
import { createObservabilityHealth } from '../runtime/observability-health';
import { decodeRuntimeLogLine } from '../runtime/runtime-log-entry';
import type { RuntimeLogger } from '../runtime/runtime-logger';
import type { ObservabilityStorage } from './observability-storage';

export const OBSERVABILITY_RETENTION_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const OBSERVABILITY_TOTAL_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const RETENTION_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;

export interface RetentionIndexPruner {
  /** Removes projections whose source Journal files are no longer retained. */
  prune(input: { readonly retainedJournalPaths: readonly string[] }): Promise<void>;
}

export interface RetentionResult {
  readonly capacityAvailable: boolean;
  readonly totalBytes: number;
  readonly deletedFiles: readonly string[];
}

export interface RetentionCleaner {
  /** Removes stale startup temporary files before applying normal retention. */
  startup(): Promise<RetentionResult>;
  /** Applies age retention and the configured hard size ceiling. */
  maintain(): Promise<RetentionResult>;
  /** Checks bytes first; attempts safe cleanup only when the proposed write exceeds capacity. */
  ensureCapacity(additionalBytes: number): Promise<boolean>;
  /** Stops periodic maintenance after all accepted cleanup work settles. */
  shutdown(): Promise<void>;
}

export interface CreateRetentionCleanerOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly health?: ObservabilityHealth;
  readonly runtimeLogger?: Pick<RuntimeLogger, 'write'>;
  readonly index?: RetentionIndexPruner;
  readonly activeFilePaths?: () => ReadonlySet<string>;
  readonly protectedContentIds?: () => ReadonlySet<string>;
  readonly now?: () => Date;
  readonly maxAgeMs?: number;
  readonly maxTotalBytes?: number;
  readonly maintenanceIntervalMs?: number;
}

interface SegmentCandidate {
  readonly paths: readonly string[];
  readonly endAtMs: number;
}

// Retention understands storage structure, not the current product's business vocabulary.
const RetentionRecordBaseSchema = z.object({
  schemaVersion: z.literal(1),
  traceId: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
});
const RetentionRecordSchema = z.discriminatedUnion('type', [
  RetentionRecordBaseSchema.extend({
    type: z.enum(['trace.started', 'trace.linked', 'span.started', 'span.event', 'span.ended', 'trace.ended']),
  }),
  RetentionRecordBaseSchema.extend({
    type: z.literal('content.recorded'),
    content: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('stored'), contentId: z.string().regex(/^[a-f0-9]{64}$/) }),
      z.object({ mode: z.literal('inline') }),
      z.object({ mode: z.literal('redacted') }),
      z.object({ mode: z.literal('unavailable') }),
    ]),
  }),
]);
type RetentionRecord = z.infer<typeof RetentionRecordSchema>;

interface RetentionFailure {
  readonly path?: string;
  readonly lineNumber?: number;
  readonly reason: string;
}
type ReportRetentionFailure = (failure?: RetentionFailure) => void;

interface TraceSegment {
  readonly path: string;
  readonly order: string;
  readonly records: readonly RetentionRecord[];
  readonly traceIds: ReadonlySet<string>;
  readonly safe: boolean;
}

/** Creates the only owner allowed to choose which Observability files are retained. */
export function createRetentionCleaner(
  options: CreateRetentionCleanerOptions,
): RetentionCleaner {
  const health = options.health ?? createObservabilityHealth();
  const now = options.now ?? (() => new Date());
  const maxAgeMs = options.maxAgeMs ?? OBSERVABILITY_RETENTION_AGE_MS;
  const maxTotalBytes = options.maxTotalBytes ?? OBSERVABILITY_TOTAL_MAX_BYTES;
  const maintenanceIntervalMs = options.maintenanceIntervalMs
    ?? RETENTION_MAINTENANCE_INTERVAL_MS;
  let maintenanceTail = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | undefined;

  const reportCleanupFailure: ReportRetentionFailure = (failure): void => {
    health.recordRetentionCleanupFailure();
    try {
      options.runtimeLogger?.write({
        level: 'warn',
        module: 'observability',
        code: 'retention_cleanup_failed',
        message: 'Observability retention maintenance could not inspect or remove a file.',
        ...(failure ? {
          data: {
            ...failure,
            ...(failure.path ? { path: relative(options.rootDirectory, failure.path) } : {}),
          },
        } : {}),
      });
    } catch {
      // Runtime Log failure cannot recurse into retention or product work.
    }
  };

  const run = async (
    additionalBytes: number,
    reportFailure: ReportRetentionFailure,
    capacityOnly: boolean,
  ): Promise<RetentionResult> => {
    if (capacityOnly) {
      const totalBytes = await measureDirectoryBytes(options.storage, options.rootDirectory);
      if (totalBytes + additionalBytes <= maxTotalBytes) {
        return { capacityAvailable: true, totalBytes, deletedFiles: [] };
      }
    }
    const deletedFiles: string[] = [];
    const activePaths = options.activeFilePaths?.() ?? new Set<string>();
    const cutoffMs = now().getTime() - maxAgeMs;
    let candidates = await loadClosedCandidates(options, activePaths, reportFailure);
    const expired = candidates.filter((candidate) => candidate.endAtMs < cutoffMs);
    for (const candidate of expired) {
      if (isCurrentlyActive(options, candidate)) continue;
      await deleteCandidate(options.storage, candidate, deletedFiles, reportFailure);
    }
    if (deletedFiles.length > 0) {
      await collectContentAndPruneIndex(options, health, reportFailure);
    }

    let totalBytes = await measureDirectoryBytes(options.storage, options.rootDirectory);
    if (totalBytes + additionalBytes > maxTotalBytes) {
      candidates = await loadClosedCandidates(options, activePaths, reportFailure);
      for (const candidate of candidates) {
        if (candidate.paths.every((path) => deletedFiles.includes(path))) continue;
        if (isCurrentlyActive(options, candidate)) continue;
        await deleteCandidate(options.storage, candidate, deletedFiles, reportFailure);
        await collectContentAndPruneIndex(options, health, reportFailure);
        totalBytes = await measureDirectoryBytes(options.storage, options.rootDirectory);
        if (totalBytes + additionalBytes <= maxTotalBytes) break;
      }
    }

    totalBytes = await measureDirectoryBytes(options.storage, options.rootDirectory);
    return {
      capacityAvailable: totalBytes + additionalBytes <= maxTotalBytes,
      totalBytes,
      deletedFiles,
    };
  };

  const runSafely = (
    additionalBytes: number,
    reportFailure: ReportRetentionFailure = reportCleanupFailure,
    capacityOnly = false,
  ): Promise<RetentionResult> => {
    const operation = maintenanceTail.then(() => run(additionalBytes, reportFailure, capacityOnly));
    maintenanceTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.catch(() => {
      reportFailure();
      return {
        capacityAvailable: false,
        totalBytes: maxTotalBytes,
        deletedFiles: [],
      };
    });
  };

  const scheduleMaintenance = (): void => {
    if (timer) return;
    timer = setInterval(() => {
      void runSafely(0);
    }, maintenanceIntervalMs);
    timer.unref?.();
  };

  return {
    async startup() {
      await maintenanceTail;
      try {
        await removeStartupTemporaryFiles(options, reportCleanupFailure);
      } catch {
        reportCleanupFailure();
      }
      await collectContentAndPruneIndex(options, health, reportCleanupFailure);
      const result = await runSafely(0);
      scheduleMaintenance();
      return result;
    },
    maintain: () => runSafely(0),
    async ensureCapacity(additionalBytes) {
      if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) return false;
      // A write-time check must not enqueue another write into the same diagnostic queue.
      // Keep health counters; startup and scheduled maintenance still emit the Runtime warning.
      return (await runSafely(additionalBytes, () => health.recordRetentionCleanupFailure(), true)).capacityAvailable;
    },
    async shutdown() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      await maintenanceTail;
    },
  };
}

function isCurrentlyActive(
  options: CreateRetentionCleanerOptions,
  candidate: SegmentCandidate,
): boolean {
  const activePaths = options.activeFilePaths?.();
  return Boolean(activePaths && candidate.paths.some((path) => activePaths.has(path)));
}

/** Loads complete Trace groups and closed Runtime segments in oldest-first order. */
async function loadClosedCandidates(
  options: CreateRetentionCleanerOptions,
  activePaths: ReadonlySet<string>,
  reportFailure: ReportRetentionFailure,
): Promise<SegmentCandidate[]> {
  const traceSegments = await loadTraceSegments(options, reportFailure);
  const traceCandidates = groupClosedTraceSegments(traceSegments, activePaths);
  const runtimeCandidates = await loadClosedRuntimeSegments(options, activePaths, reportFailure);
  return [...traceCandidates, ...runtimeCandidates]
    .sort((left, right) => left.endAtMs - right.endAtMs);
}

/** Reads retention metadata; unknown or corrupt storage structure prevents unsafe deletion. */
async function loadTraceSegments(
  options: CreateRetentionCleanerOptions,
  reportFailure: ReportRetentionFailure,
): Promise<TraceSegment[]> {
  const directoryPath = join(options.rootDirectory, 'traces');
  const entries = await options.storage.listEntries(directoryPath);
  const names = entries
    .filter((entry) => entry.kind === 'file' && /^trace-v\d+-.*\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const segments: TraceSegment[] = [];
  for (const name of names) {
    const path = join(directoryPath, name);
    try {
      const records = decodeRetentionRecords(await options.storage.readText(path), path, reportFailure);
      segments.push({
        path,
        order: name,
        records: records ?? [],
        traceIds: new Set(records?.map((record) => record.traceId)),
        safe: records !== undefined && records.length > 0,
      });
    } catch {
      reportFailure({ path, reason: 'journal_read_failed' });
      segments.push({ path, order: name, records: [], traceIds: new Set(), safe: false });
    }
  }
  return segments;
}

/** Groups every segment connected by a Trace ID so retention never preserves half a Trace. */
function groupClosedTraceSegments(
  segments: readonly TraceSegment[],
  activePaths: ReadonlySet<string>,
): SegmentCandidate[] {
  if (segments.some((segment) => !segment.safe)) {
    return [];
  }
  const remaining = new Set(segments.map((segment) => segment.path));
  const candidates: SegmentCandidate[] = [];
  for (const seed of segments) {
    if (!remaining.delete(seed.path)) continue;
    const group: TraceSegment[] = [seed];
    const traceIds = new Set(seed.traceIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const segment of segments) {
        if (!remaining.has(segment.path) || !setsIntersect(traceIds, segment.traceIds)) continue;
        remaining.delete(segment.path);
        group.push(segment);
        for (const traceId of segment.traceIds) traceIds.add(traceId);
        expanded = true;
      }
    }

    const records = group.flatMap((segment) => [...segment.records]);
    const ended = new Map<string, number>();
    for (const record of records) {
      if (record.type === 'trace.ended') {
        ended.set(record.traceId, Date.parse(record.timestamp));
      }
    }
    const closed = group.every((segment) => segment.safe && !activePaths.has(segment.path))
      && traceIds.size > 0
      && [...traceIds].every((traceId) => ended.has(traceId));
    if (!closed) continue;
    let endAtMs = Number.NEGATIVE_INFINITY;
    for (const timestamp of ended.values()) endAtMs = Math.max(endAtMs, timestamp);
    candidates.push({
      paths: group.sort((left, right) => left.order.localeCompare(right.order))
        .map((segment) => segment.path),
      endAtMs,
    });
  }
  return candidates;
}

/** Treats every non-active, strictly decodable Runtime segment as independently closed. */
async function loadClosedRuntimeSegments(
  options: CreateRetentionCleanerOptions,
  activePaths: ReadonlySet<string>,
  reportFailure: ReportRetentionFailure,
): Promise<SegmentCandidate[]> {
  const directoryPath = join(options.rootDirectory, 'runtime');
  const entries = await options.storage.listEntries(directoryPath);
  const candidates: SegmentCandidate[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file' || !/^runtime-v1-\d{4}-\d{2}-\d{2}-\d{4}\.jsonl$/.test(entry.name)) {
      continue;
    }
    const path = join(directoryPath, entry.name);
    if (activePaths.has(path)) continue;
    try {
      const lines = nonEmptyLines(await options.storage.readText(path));
      let endAtMs = Number.NEGATIVE_INFINITY;
      for (const line of lines) {
        endAtMs = Math.max(endAtMs, Date.parse(decodeRuntimeLogLine(line).timestamp));
      }
      if (Number.isFinite(endAtMs)) {
        candidates.push({ paths: [path], endAtMs });
      }
    } catch {
      reportFailure();
    }
  }
  return candidates;
}

async function deleteCandidate(
  storage: ObservabilityStorage,
  candidate: SegmentCandidate,
  deletedFiles: string[],
  reportFailure: ReportRetentionFailure,
): Promise<void> {
  for (const path of candidate.paths) {
    try {
      await storage.removeFile(path);
      deletedFiles.push(path);
    } catch {
      reportFailure({ path, reason: 'file_delete_failed' });
      return;
    }
  }
}

/** Recomputes retained Content references before GC, then lets Index follow Journal truth. */
async function collectContentAndPruneIndex(
  options: CreateRetentionCleanerOptions,
  health: ObservabilityHealth,
  reportFailure: ReportRetentionFailure,
): Promise<void> {
  const retained = await readRetainedJournalContentIds(options, reportFailure);
  if (retained) {
    await removeUnreferencedContent(options, retained, reportFailure);
  }
  if (!options.index) return;
  try {
    await options.index.prune({
      retainedJournalPaths: await retainedJournalPaths(options.storage, options.rootDirectory),
    });
  } catch {
    health.recordIndexProjectionFailure();
    reportFailure();
  }
}

/** Returns undefined when any retained Journal cannot prove the complete Content reference set. */
async function readRetainedJournalContentIds(
  options: CreateRetentionCleanerOptions,
  reportFailure: ReportRetentionFailure,
): Promise<ReadonlySet<string> | undefined> {
  const contentIds = new Set(options.protectedContentIds?.() ?? []);
  for (const path of await retainedJournalPaths(options.storage, options.rootDirectory)) {
    try {
      const records = decodeRetentionRecords(await options.storage.readText(path), path, reportFailure);
      if (!records) return undefined;
      for (const record of records) {
        if (record.type === 'content.recorded' && record.content.mode === 'stored') {
          contentIds.add(record.content.contentId);
        }
      }
    } catch {
      reportFailure({ path, reason: 'journal_read_failed' });
      return undefined;
    }
  }
  return contentIds;
}

async function removeUnreferencedContent(
  options: CreateRetentionCleanerOptions,
  retainedContentIds: ReadonlySet<string>,
  reportFailure: ReportRetentionFailure,
): Promise<void> {
  const hashRoot = join(options.rootDirectory, 'content', 'sha256');
  const prefixes = await options.storage.listEntries(hashRoot);
  for (const prefix of prefixes) {
    if (prefix.kind !== 'directory') continue;
    const directoryPath = join(hashRoot, prefix.name);
    for (const entry of await options.storage.listEntries(directoryPath)) {
      const match = entry.kind === 'file' ? /^([a-f0-9]{64})\.blob$/.exec(entry.name) : undefined;
      if (!match?.[1] || retainedContentIds.has(match[1])) continue;
      try {
        await options.storage.removeFile(join(directoryPath, entry.name));
      } catch {
        reportFailure({ path: join(directoryPath, entry.name), reason: 'file_delete_failed' });
      }
    }
  }
}

/** Deletes untrusted temporary files one-by-one during startup maintenance. */
async function removeStartupTemporaryFiles(
  options: CreateRetentionCleanerOptions,
  reportFailure: ReportRetentionFailure,
): Promise<void> {
  const hashRoot = join(options.rootDirectory, 'content', 'sha256');
  for (const prefix of await options.storage.listEntries(hashRoot)) {
    if (prefix.kind !== 'directory') continue;
    const directoryPath = join(hashRoot, prefix.name);
    for (const entry of await options.storage.listEntries(directoryPath)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.tmp')) continue;
      try {
        await options.storage.removeFile(join(directoryPath, entry.name));
      } catch {
        reportFailure({ path: join(directoryPath, entry.name), reason: 'file_delete_failed' });
      }
    }
  }
}

/** Measures the known Observability directory tree without exposing recursive deletion. */
async function measureDirectoryBytes(
  storage: ObservabilityStorage,
  rootDirectory: string,
): Promise<number> {
  let total = 0;
  const pending = [rootDirectory];
  while (pending.length > 0) {
    const directoryPath = pending.pop();
    if (!directoryPath) continue;
    for (const entry of await storage.listEntries(directoryPath)) {
      if (entry.kind === 'file') total += entry.size;
      else pending.push(join(directoryPath, entry.name));
    }
  }
  return total;
}

async function retainedJournalPaths(
  storage: ObservabilityStorage,
  rootDirectory: string,
): Promise<string[]> {
  const directoryPath = join(rootDirectory, 'traces');
  return (await storage.listEntries(directoryPath))
    .filter((entry) => entry.kind === 'file' && /^trace-v\d+-.*\.jsonl$/.test(entry.name))
    .map((entry) => join(directoryPath, entry.name))
    .sort();
}

/** Validates only deletion-relevant fields, retaining uncertain files without logging their contents. */
function decodeRetentionRecords(
  content: string,
  path: string,
  reportFailure: ReportRetentionFailure,
): RetentionRecord[] | undefined {
  const records: RetentionRecord[] = [];
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    if (!basename(path).startsWith('trace-v1-')) {
      reportFailure({ path, lineNumber: index + 1, reason: 'unsupported_journal_version' });
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      reportFailure({ path, lineNumber: index + 1, reason: 'invalid_json' });
      return undefined;
    }
    const parsed = RetentionRecordSchema.safeParse(value);
    if (!parsed.success) {
      // Zod messages and JSON errors can contain payload values; report only schema paths and codes.
      const reason = parsed.error.issues.map((issue) => `${issue.path.join('.')}:${issue.code}`).join(', ');
      reportFailure({ path, lineNumber: index + 1, reason });
      return undefined;
    }
    records.push(parsed.data);
  }
  if (records.length === 0) {
    reportFailure({ path, reason: 'empty_journal' });
    return undefined;
  }
  return records;
}

function nonEmptyLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.length > 0);
}

function setsIntersect(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}
