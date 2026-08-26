/*
 * Enforces age and total-size retention without deleting active or diagnostically incomplete data.
 */
import { join } from 'node:path';
import type { ObservabilityHealth } from '../runtime/observability-health';
import { createObservabilityHealth } from '../runtime/observability-health';
import { decodeRuntimeLogLine } from '../runtime/runtime-log-entry';
import type { RuntimeLogger } from '../runtime/runtime-logger';
import { decodeTraceJournalLine, type TraceJournalRecord } from './trace-journal-record';
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
  /** Cleans before a proposed write and reports whether the exact increment fits. */
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

interface TraceSegment {
  readonly path: string;
  readonly order: string;
  readonly records: readonly TraceJournalRecord[];
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

  const reportCleanupFailure = (): void => {
    health.recordRetentionCleanupFailure();
    try {
      options.runtimeLogger?.write({
        level: 'warn',
        module: 'observability',
        code: 'retention_cleanup_failed',
        message: 'Observability retention cleanup could not remove an exact file.',
      });
    } catch {
      // Runtime Log failure cannot recurse into retention or product work.
    }
  };

  const run = async (additionalBytes: number): Promise<RetentionResult> => {
    const deletedFiles: string[] = [];
    const activePaths = options.activeFilePaths?.() ?? new Set<string>();
    const cutoffMs = now().getTime() - maxAgeMs;
    let candidates = await loadClosedCandidates(options, activePaths, reportCleanupFailure);
    const expired = candidates.filter((candidate) => candidate.endAtMs < cutoffMs);
    for (const candidate of expired) {
      if (isCurrentlyActive(options, candidate)) continue;
      await deleteCandidate(options.storage, candidate, deletedFiles, reportCleanupFailure);
    }
    if (deletedFiles.length > 0) {
      await collectContentAndPruneIndex(options, health, reportCleanupFailure);
    }

    let totalBytes = await measureDirectoryBytes(options.storage, options.rootDirectory);
    if (totalBytes + additionalBytes > maxTotalBytes) {
      candidates = await loadClosedCandidates(options, activePaths, reportCleanupFailure);
      for (const candidate of candidates) {
        if (candidate.paths.every((path) => deletedFiles.includes(path))) continue;
        if (isCurrentlyActive(options, candidate)) continue;
        await deleteCandidate(options.storage, candidate, deletedFiles, reportCleanupFailure);
        await collectContentAndPruneIndex(options, health, reportCleanupFailure);
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

  const runSafely = (additionalBytes: number): Promise<RetentionResult> => {
    const operation = maintenanceTail.then(() => run(additionalBytes));
    maintenanceTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation.catch(() => {
      reportCleanupFailure();
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
      return (await runSafely(additionalBytes)).capacityAvailable;
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
  reportFailure: () => void,
): Promise<SegmentCandidate[]> {
  const traceSegments = await loadTraceSegments(options, reportFailure);
  const traceCandidates = groupClosedTraceSegments(traceSegments, activePaths);
  const runtimeCandidates = await loadClosedRuntimeSegments(options, activePaths, reportFailure);
  return [...traceCandidates, ...runtimeCandidates]
    .sort((left, right) => left.endAtMs - right.endAtMs);
}

/** Reads strict Journal segments; a corrupt segment remains retained because closure is unprovable. */
async function loadTraceSegments(
  options: CreateRetentionCleanerOptions,
  reportFailure: () => void,
): Promise<TraceSegment[]> {
  const directoryPath = join(options.rootDirectory, 'traces');
  const entries = await options.storage.listEntries(directoryPath);
  const names = entries
    .filter((entry) => entry.kind === 'file' && /^trace-v1-\d{4}-\d{2}-\d{2}-\d{4}\.jsonl$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const segments: TraceSegment[] = [];
  for (const name of names) {
    const path = join(directoryPath, name);
    try {
      const records = decodeTraceLines(await options.storage.readText(path));
      segments.push({
        path,
        order: name,
        records,
        traceIds: new Set(records.map((record) => record.traceId)),
        safe: records.length > 0,
      });
    } catch {
      reportFailure();
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
  reportFailure: () => void,
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
  reportFailure: () => void,
): Promise<void> {
  for (const path of candidate.paths) {
    try {
      await storage.removeFile(path);
      deletedFiles.push(path);
    } catch {
      reportFailure();
      return;
    }
  }
}

/** Recomputes retained Content references before GC, then lets Index follow Journal truth. */
async function collectContentAndPruneIndex(
  options: CreateRetentionCleanerOptions,
  health: ObservabilityHealth,
  reportFailure: () => void,
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
  reportFailure: () => void,
): Promise<ReadonlySet<string> | undefined> {
  const contentIds = new Set(options.protectedContentIds?.() ?? []);
  for (const path of await retainedJournalPaths(options.storage, options.rootDirectory)) {
    try {
      for (const record of decodeTraceLines(await options.storage.readText(path))) {
        if (record.type === 'content.recorded' && record.content.mode === 'stored') {
          contentIds.add(record.content.contentId);
        }
      }
    } catch {
      reportFailure();
      return undefined;
    }
  }
  return contentIds;
}

async function removeUnreferencedContent(
  options: CreateRetentionCleanerOptions,
  retainedContentIds: ReadonlySet<string>,
  reportFailure: () => void,
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
        reportFailure();
      }
    }
  }
}

/** Deletes untrusted temporary files one-by-one during startup maintenance. */
async function removeStartupTemporaryFiles(
  options: CreateRetentionCleanerOptions,
  reportFailure: () => void,
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
        reportFailure();
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
    .filter((entry) => entry.kind === 'file' && /^trace-v1-.*\.jsonl$/.test(entry.name))
    .map((entry) => join(directoryPath, entry.name))
    .sort();
}

function decodeTraceLines(content: string): TraceJournalRecord[] {
  return nonEmptyLines(content).map((line) => decodeTraceJournalLine(line));
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
