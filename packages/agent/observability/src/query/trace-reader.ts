/*
 * Synchronizes the disposable Trace index and reconstructs only explicitly requested Journal evidence.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { createContentStore, type ContentStore } from '../content/content-store';
import type { ObservabilityStorage } from '../persistence/observability-storage';
import type {
  JournalCheckpoint,
  TraceIndex,
  TraceRecordLocator,
} from '../persistence/trace-index';
import {
  decodeTraceJournalLine,
  type TraceJournalRecord,
} from '../persistence/trace-journal-record';
import { TraceCorrelationSchema } from '../trace/trace-contract';
import type { TraceListQuery, TraceReader, TraceSummaryProjection } from './trace-query';
import {
  projectTrace,
  summarizeTrace,
  type InvalidJournalFact,
  type TraceProjection,
} from './trace-projector';

const DETAIL_CACHE_LIMIT = 20;
const NEWLINE_BYTE = 0x0a;
const CARRIAGE_RETURN_BYTE = 0x0d;

const InvalidRecordIdentitySchema = z.object({
  schemaVersion: z.number().optional(),
  traceId: z.string().uuid(),
  sequence: z.number().int().positive().optional(),
}).passthrough();

const SCALAR_CORRELATION_KEYS = [
  'requestId', 'executionId', 'sessionId', 'messageId', 'workspaceId', 'batchId',
  'compactionId', 'modelCallId', 'toolCallId', 'sourceId', 'candidateId',
  'recommendationId', 'contentId', 'contentDigest', 'providerAttempt', 'discoveryAttempt',
] as const;

interface ScannedTraceFacts {
  readonly records: TraceJournalRecord[];
  readonly invalidFacts: InvalidJournalFact[];
  readonly sourceFiles: Set<string>;
}

interface JournalFile {
  readonly path: string;
  readonly name: string;
  readonly date: string;
  readonly segment: number;
  readonly size: number;
  readonly modifiedAtMs: number;
}

interface JournalScan {
  readonly facts: Map<string, ScannedTraceFacts>;
  readonly records: TraceRecordLocator[];
  readonly checkpoints: JournalCheckpoint[];
}

export interface CreateTraceReaderOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly contentStore?: ContentStore;
  readonly index?: TraceIndex;
}

/** Creates a Reader whose query cost follows Journal growth and the selected Trace, not retained Content. */
export function createTraceReader(options: CreateTraceReaderOptions): TraceReader {
  const contentStore = options.contentStore ?? createContentStore({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
  });
  const detailCache = new Map<string, TraceProjection>();
  let synchronization: Promise<boolean> | undefined;

  const synchronize = (): Promise<boolean> => {
    synchronization ??= synchronizeIndex(options, detailCache)
      .finally(() => { synchronization = undefined; });
    return synchronization;
  };

  const readAll = async (): Promise<TraceProjection[]> => {
    const scan = await scanJournal(options, await listJournalFiles(options), new Map());
    return projectFacts(scan.facts);
  };

  return {
    async listTraces(query = {}) {
      if (options.index && await synchronize()) {
        try {
          return options.index.queryTraces(query);
        } catch {
          // Fall through to streaming Journal projection when the disposable Index fails.
        }
      }
      const traces = await readAll();
      return traces
        .filter((trace) => matchesQuery(trace, query))
        .map(summarizeTrace)
        .slice(0, query.limit ?? 200);
    },

    async getTrace(traceId) {
      if (options.index && await synchronize()) {
        const cached = takeCachedTrace(detailCache, traceId);
        if (cached) return cached;
        try {
          const locators = options.index.getRecordLocators(traceId);
          if (locators.length === 0) return undefined;
          const trace = await readTraceFromLocators(options.storage, traceId, locators);
          cacheTrace(detailCache, trace);
          return trace;
        } catch {
          // Fall through to streaming Journal projection when indexed locations are unreadable.
        }
      }
      const trace = (await readAll()).find((candidate) => candidate.traceId === traceId);
      if (trace) cacheTrace(detailCache, trace);
      return trace;
    },

    readContent: (contentId) => contentStore.read(contentId),

    async rebuildIndex() {
      if (!options.index) return false;
      try {
        await rebuildIndex(options, options.index);
        detailCache.clear();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Synchronizes only appended Journal bytes and reprojects only the affected Traces. */
async function synchronizeIndex(
  options: CreateTraceReaderOptions,
  detailCache: Map<string, TraceProjection>,
): Promise<boolean> {
  const index = options.index;
  if (!index) return false;
  try {
    const state = index.initialize();
    const files = await listJournalFiles(options);
    const checkpoints = index.readCheckpoints();
    if (state.status === 'rebuilt' || requiresRebuild(files, checkpoints)) {
      await rebuildIndex(options, index, files);
      detailCache.clear();
      return true;
    }

    const checkpointByPath = new Map(checkpoints.map((checkpoint) => [
      checkpoint.filePath,
      checkpoint,
    ]));
    const changedFiles = files.filter((file) => {
      const checkpoint = checkpointByPath.get(file.path);
      return !checkpoint
        || file.size !== checkpoint.size
        || file.modifiedAtMs !== checkpoint.modifiedAtMs;
    });
    if (changedFiles.length === 0) return true;

    const starts = new Map(changedFiles.map((file) => [
      file.path,
      checkpointByPath.get(file.path)?.consumedBytes ?? 0,
    ]));
    const tail = await scanJournal(options, changedFiles, starts);
    const changedTraceIds = [...tail.facts.keys()];
    const traces: TraceProjection[] = [];
    for (const traceId of changedTraceIds) {
      const currentLocators = index.getRecordLocators(traceId);
      const appendedLocators = tail.records.filter(
        (locator) => locator.traceId === traceId,
      );
      traces.push(currentLocators.length === 0
        ? projectScannedTrace(traceId, tail.facts.get(traceId))
        : await readTraceFromLocators(
            options.storage,
            traceId,
            mergeLocators(currentLocators, appendedLocators),
          ));
      detailCache.delete(traceId);
    }
    const updatedCheckpoints = files.map((file) => (
      tail.checkpoints.find((checkpoint) => checkpoint.filePath === file.path)
      ?? checkpointByPath.get(file.path)
      ?? { filePath: file.path, consumedBytes: 0, size: file.size, modifiedAtMs: file.modifiedAtMs }
    ));
    index.apply({ traces, records: tail.records, checkpoints: updatedCheckpoints });
    return true;
  } catch {
    return false;
  }
}

/** Performs the explicit recovery path from retained Journal truth. */
async function rebuildIndex(
  options: CreateTraceReaderOptions,
  index: TraceIndex,
  knownFiles?: readonly JournalFile[],
): Promise<void> {
  index.initialize();
  const scan = await scanJournal(options, knownFiles ?? await listJournalFiles(options), new Map());
  index.replace({
    traces: projectFacts(scan.facts),
    records: scan.records,
    checkpoints: scan.checkpoints,
  });
}

function requiresRebuild(
  files: readonly JournalFile[],
  checkpoints: readonly JournalCheckpoint[],
): boolean {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  for (const checkpoint of checkpoints) {
    const file = fileByPath.get(checkpoint.filePath);
    if (!file || file.size < checkpoint.size || file.size < checkpoint.consumedBytes) return true;
    if (file.size === checkpoint.size && file.modifiedAtMs !== checkpoint.modifiedAtMs) return true;
  }
  return false;
}

/** Lists strict Trace Journal segments in semantic order rather than directory order. */
async function listJournalFiles(options: CreateTraceReaderOptions): Promise<JournalFile[]> {
  const directoryPath = join(options.rootDirectory, 'traces');
  const entries = await options.storage.listEntries(directoryPath);
  return entries.flatMap((entry): JournalFile[] => {
    if (entry.kind !== 'file') return [];
    const match = /^trace-v(\d+)-(\d{4}-\d{2}-\d{2})-(\d{4})\.jsonl$/.exec(entry.name);
    return match?.[1] && match[2] && match[3]
      ? [{
          path: join(directoryPath, entry.name),
          name: entry.name,
          date: match[2],
          segment: Number(match[3]),
          size: entry.size,
          modifiedAtMs: entry.modifiedAtMs,
        }]
      : [];
  }).sort((left, right) => (
    left.date.localeCompare(right.date)
    || left.segment - right.segment
    || left.name.localeCompare(right.name)
  ));
}

/** Scans complete newline-delimited records from the supplied byte positions. */
async function scanJournal(
  options: CreateTraceReaderOptions,
  files: readonly JournalFile[],
  starts: ReadonlyMap<string, number>,
): Promise<JournalScan> {
  const facts = new Map<string, ScannedTraceFacts>();
  const records: TraceRecordLocator[] = [];
  const checkpoints: JournalCheckpoint[] = [];
  for (const file of files) {
    const start = starts.get(file.path) ?? 0;
    let bytes: Uint8Array;
    try {
      bytes = await options.storage.readBytesRange(file.path, start, Math.max(0, file.size - start));
    } catch {
      continue;
    }
    let lineStart = 0;
    let consumedBytes = start;
    for (let index = 0; index < bytes.byteLength; index += 1) {
      if (bytes[index] !== NEWLINE_BYTE) continue;
      const rawEnd = index > lineStart && bytes[index - 1] === CARRIAGE_RETURN_BYTE
        ? index - 1
        : index;
      if (rawEnd > lineStart) {
        const line = new TextDecoder().decode(bytes.subarray(lineStart, rawEnd));
        collectLine({
          line,
          filePath: file.path,
          byteOffset: start + lineStart,
          byteLength: rawEnd - lineStart,
          facts,
          records,
        });
      }
      lineStart = index + 1;
      consumedBytes = start + lineStart;
    }
    checkpoints.push({
      filePath: file.path,
      consumedBytes,
      size: file.size,
      modifiedAtMs: file.modifiedAtMs,
    });
  }
  return { facts, records, checkpoints };
}

interface CollectLineInput {
  readonly line: string;
  readonly filePath: string;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly facts: Map<string, ScannedTraceFacts>;
  readonly records: TraceRecordLocator[];
}

/** Assigns one valid or safely identifiable invalid line to its owning Trace. */
function collectLine(input: CollectLineInput): void {
  try {
    const record = decodeTraceJournalLine(input.line);
    const facts = getOrCreateFacts(input.facts, record.traceId);
    facts.records.push(record);
    facts.sourceFiles.add(input.filePath);
    input.records.push({
      traceId: record.traceId,
      sequence: record.sequence,
      filePath: input.filePath,
      byteOffset: input.byteOffset,
      byteLength: input.byteLength,
    });
  } catch {
    const invalid = identifyInvalidFact(input.line, input.filePath);
    if (!invalid) return;
    const facts = getOrCreateFacts(input.facts, invalid.traceId);
    facts.invalidFacts.push(invalid);
    facts.sourceFiles.add(input.filePath);
    input.records.push({
      traceId: invalid.traceId,
      ...(invalid.sequence ? { sequence: invalid.sequence } : {}),
      filePath: input.filePath,
      byteOffset: input.byteOffset,
      byteLength: input.byteLength,
    });
  }
}

/** Reads the minimum file ranges enclosing one Trace's indexed records. */
async function readTraceFromLocators(
  storage: ObservabilityStorage,
  traceId: string,
  locators: readonly TraceRecordLocator[],
): Promise<TraceProjection> {
  const facts = new Map<string, ScannedTraceFacts>();
  const byFile = new Map<string, TraceRecordLocator[]>();
  for (const locator of locators) {
    const existing = byFile.get(locator.filePath) ?? [];
    existing.push(locator);
    byFile.set(locator.filePath, existing);
  }
  for (const [filePath, fileLocators] of byFile) {
    fileLocators.sort((left, right) => left.byteOffset - right.byteOffset);
    const first = fileLocators[0];
    const last = fileLocators.at(-1);
    if (!first || !last) continue;
    const rangeEnd = last.byteOffset + last.byteLength;
    const bytes = await storage.readBytesRange(filePath, first.byteOffset, rangeEnd - first.byteOffset);
    for (const locator of fileLocators) {
      const relativeOffset = locator.byteOffset - first.byteOffset;
      const end = relativeOffset + locator.byteLength;
      if (relativeOffset < 0 || end > bytes.byteLength) continue;
      collectLine({
        line: new TextDecoder().decode(bytes.subarray(relativeOffset, end)),
        filePath,
        byteOffset: locator.byteOffset,
        byteLength: locator.byteLength,
        facts,
        records: [],
      });
    }
  }
  const value = facts.get(traceId) ?? {
    records: [],
    invalidFacts: [],
    sourceFiles: new Set<string>(),
  };
  return projectTrace({
    traceId,
    records: value.records,
    invalidFacts: value.invalidFacts,
    sourceFiles: [...value.sourceFiles],
  });
}

function projectFacts(facts: ReadonlyMap<string, ScannedTraceFacts>): TraceProjection[] {
  return [...facts].map(([traceId, value]) => projectScannedTrace(traceId, value)).sort((left, right) => (
    (right.startedAt ?? '').localeCompare(left.startedAt ?? '')
    || left.traceId.localeCompare(right.traceId)
  ));
}

function projectScannedTrace(
  traceId: string,
  facts: ScannedTraceFacts | undefined,
): TraceProjection {
  return projectTrace({
    traceId,
    records: facts?.records ?? [],
    invalidFacts: facts?.invalidFacts ?? [],
    sourceFiles: [...(facts?.sourceFiles ?? [])],
  });
}

function identifyInvalidFact(line: string, sourceFile: string): InvalidJournalFact | undefined {
  try {
    const value: unknown = JSON.parse(line);
    const identity = InvalidRecordIdentitySchema.safeParse(value);
    if (!identity.success) return undefined;
    const code = identity.data.schemaVersion !== 1 ? 'unknown_schema' : 'invalid_record';
    return {
      traceId: identity.data.traceId,
      ...(identity.data.sequence ? { sequence: identity.data.sequence } : {}),
      issue: {
        code,
        ...(identity.data.sequence ? { sequence: identity.data.sequence } : {}),
        sourceFile,
      },
    };
  } catch {
    return undefined;
  }
}

function mergeLocators(
  current: readonly TraceRecordLocator[],
  appended: readonly TraceRecordLocator[],
): TraceRecordLocator[] {
  const merged = new Map<string, TraceRecordLocator>();
  for (const locator of [...current, ...appended]) {
    merged.set(`${locator.filePath}:${locator.byteOffset}`, locator);
  }
  return [...merged.values()];
}

function cacheTrace(cache: Map<string, TraceProjection>, trace: TraceProjection): void {
  cache.delete(trace.traceId);
  cache.set(trace.traceId, trace);
  while (cache.size > DETAIL_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') return;
    cache.delete(oldest);
  }
}

function takeCachedTrace(
  cache: Map<string, TraceProjection>,
  traceId: string,
): TraceProjection | undefined {
  const trace = cache.get(traceId);
  if (!trace) return undefined;
  cache.delete(traceId);
  cache.set(traceId, trace);
  return trace;
}

function matchesQuery(trace: TraceProjection, query: TraceListQuery): boolean {
  if (query.startedAtOrAfter && (!trace.startedAt || trace.startedAt < query.startedAtOrAfter)) {
    return false;
  }
  if (query.startedBefore && (!trace.startedAt || trace.startedAt >= query.startedBefore)) {
    return false;
  }
  if (query.traceKind && trace.traceKind !== query.traceKind) return false;
  if (query.status && trace.status !== query.status) return false;
  if (query.spanName && !trace.spans.some((span) => span.name === query.spanName)) return false;
  if (query.contentKind && !trace.contents.some((content) => content.kind === query.contentKind)) {
    return false;
  }
  return !query.correlation || correlationSetContains(trace.correlations, query.correlation);
}

function correlationSetContains(
  candidates: TraceProjection['correlations'],
  required: TraceProjection['correlations'][number],
): boolean {
  const parsed = TraceCorrelationSchema.parse(required);
  for (const key of SCALAR_CORRELATION_KEYS) {
    if (parsed[key] !== undefined && !candidates.some((candidate) => candidate[key] === parsed[key])) {
      return false;
    }
  }
  return !parsed.recommendationIds || parsed.recommendationIds.every((recommendationId) => (
    candidates.some((candidate) => candidate.recommendationIds?.includes(recommendationId))
  ));
}

function getOrCreateFacts(
  facts: Map<string, ScannedTraceFacts>,
  traceId: string,
): ScannedTraceFacts {
  const existing = facts.get(traceId);
  if (existing) return existing;
  const created: ScannedTraceFacts = {
    records: [],
    invalidFacts: [],
    sourceFiles: new Set<string>(),
  };
  facts.set(traceId, created);
  return created;
}
