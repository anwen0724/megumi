/*
 * Reads strict Journal segments, projects Trace truth, validates Content, and optionally refreshes Index.
 */
import { join } from 'node:path';
import { z } from 'zod';
import { captureContent } from '../content/content-capture';
import { createContentStore, type ContentStore } from '../content/content-store';
import type { ObservabilityStorage } from '../persistence/observability-storage';
import type { JournalCheckpoint, TraceIndex } from '../persistence/trace-index';
import {
  decodeTraceJournalLine,
  type TraceJournalRecord,
} from '../persistence/trace-journal-record';
import { TraceCorrelationSchema } from '../trace/trace-contract';
import type { TraceListQuery, TraceReader } from './trace-query';
import {
  addTraceReadIssues,
  projectTrace,
  type InvalidJournalFact,
  type TraceProjection,
  type TraceReadIssue,
} from './trace-projector';

const InvalidRecordIdentitySchema = z.object({
  schemaVersion: z.number().optional(),
  traceId: z.string().uuid(),
  sequence: z.number().int().positive().optional(),
}).passthrough();

const SCALAR_CORRELATION_KEYS = [
  'requestId',
  'executionId',
  'sessionId',
  'messageId',
  'workspaceId',
  'batchId',
  'compactionId',
  'modelCallId',
  'toolCallId',
  'sourceId',
  'candidateId',
  'recommendationId',
  'contentId',
  'contentDigest',
  'providerAttempt',
  'discoveryAttempt',
] as const;

interface ScannedTraceFacts {
  readonly records: TraceJournalRecord[];
  readonly invalidFacts: InvalidJournalFact[];
  readonly sourceFiles: Set<string>;
}

export interface CreateTraceReaderOptions {
  readonly rootDirectory: string;
  readonly storage: ObservabilityStorage;
  readonly contentStore?: ContentStore;
  readonly index?: TraceIndex;
}

interface JournalScan {
  readonly facts: Map<string, ScannedTraceFacts>;
  readonly checkpoints: JournalCheckpoint[];
}

/** Creates a streaming Reader whose correctness never depends on directory enumeration order. */
export function createTraceReader(options: CreateTraceReaderOptions): TraceReader {
  const contentStore = options.contentStore ?? createContentStore({
    rootDirectory: options.rootDirectory,
    storage: options.storage,
  });

  const readAll = async (): Promise<{
    readonly traces: TraceProjection[];
    readonly checkpoints: JournalCheckpoint[];
  }> => {
    const scan = await scanJournal(options);
    const projections: TraceProjection[] = [];
    for (const [traceId, value] of scan.facts) {
      const projected = projectTrace({
        traceId,
        records: value.records,
        invalidFacts: value.invalidFacts,
        sourceFiles: [...value.sourceFiles],
      });
      projections.push(await validateProjectionContent(projected, contentStore));
    }
    const traces = projections.sort((left, right) => (
      (right.startedAt ?? '').localeCompare(left.startedAt ?? '')
      || left.traceId.localeCompare(right.traceId)
    ));
    refreshIndex(options.index, traces, scan.checkpoints);
    return { traces, checkpoints: scan.checkpoints };
  };

  return {
    async listTraces(query = {}) {
      const { traces } = await readAll();
      const indexedTraceIds = queryIndex(options.index, query);
      const filtered = traces.filter((trace) => (
        (!indexedTraceIds || indexedTraceIds.has(trace.traceId)) && matchesQuery(trace, query)
      ));
      return filtered.slice(0, query.limit ?? filtered.length);
    },
    async getTrace(traceId) {
      return (await readAll()).traces.find((trace) => trace.traceId === traceId);
    },
    readContent: (contentId) => contentStore.read(contentId),
    async rebuildIndex() {
      if (!options.index) return false;
      try {
        const { traces, checkpoints } = await readAll();
        options.index.initialize();
        options.index.replace({ traces, checkpoints });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Scans valid and invalid lines while assigning only safely identified failures to a Trace. */
async function scanJournal(
  options: CreateTraceReaderOptions,
): Promise<JournalScan> {
  const facts = new Map<string, ScannedTraceFacts>();
  const checkpoints: JournalCheckpoint[] = [];
  const directoryPath = join(options.rootDirectory, 'traces');
  const entries = await options.storage.listEntries(directoryPath);
  const files = entries.flatMap((entry) => {
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

  for (const file of files) {
    let content: string;
    try {
      content = await options.storage.readText(file.path);
    } catch {
      continue;
    }
    checkpoints.push({
      filePath: file.path,
      size: file.size,
      modifiedAtMs: file.modifiedAtMs,
    });
    for (const line of content.split(/\r?\n/)) {
      if (!line) continue;
      try {
        const record = decodeTraceJournalLine(line);
        const value = getOrCreateFacts(facts, record.traceId);
        value.records.push(record);
        value.sourceFiles.add(file.path);
      } catch {
        const invalid = identifyInvalidFact(line, file.path);
        if (!invalid) continue;
        const value = getOrCreateFacts(facts, invalid.traceId);
        value.invalidFacts.push(invalid);
        value.sourceFiles.add(file.path);
      }
    }
  }
  return { facts, checkpoints };
}

/** Rebuilds stale metadata opportunistically; all failures leave streaming results intact. */
function refreshIndex(
  index: TraceIndex | undefined,
  traces: readonly TraceProjection[],
  checkpoints: readonly JournalCheckpoint[],
): void {
  if (!index) return;
  try {
    const state = index.initialize();
    if (state.status === 'rebuilt' || !index.matchesCheckpoints(checkpoints)) {
      index.replace({ traces, checkpoints });
    }
  } catch {
    // The Journal projection above remains the read result.
  }
}

function queryIndex(
  index: TraceIndex | undefined,
  query: TraceListQuery,
): ReadonlySet<string> | undefined {
  if (!index) return undefined;
  try {
    return new Set(index.queryTraceIds(query));
  } catch {
    return undefined;
  }
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

async function validateProjectionContent(
  projection: TraceProjection,
  contentStore: ContentStore,
): Promise<TraceProjection> {
  const issues: TraceReadIssue[] = [];
  for (const checkpoint of projection.contents) {
    if (checkpoint.content.mode === 'inline') {
      const captured = captureContent({
        value: checkpoint.content.value,
        mediaType: checkpoint.content.mediaType,
        inlineThresholdBytes: Number.MAX_SAFE_INTEGER,
      });
      if (
        (captured.content.mode !== 'inline' && captured.content.mode !== 'stored')
        || captured.content.contentId !== checkpoint.content.contentId
      ) {
        issues.push({
          code: 'content_hash_mismatch',
          sequence: checkpoint.sequence,
          contentId: checkpoint.content.contentId,
        });
      }
      continue;
    }
    if (checkpoint.content.mode !== 'stored') continue;
    const read = await contentStore.read(checkpoint.content.contentId);
    if (read.status === 'missing') {
      issues.push({
        code: 'missing_content',
        sequence: checkpoint.sequence,
        contentId: checkpoint.content.contentId,
      });
    } else if (read.status === 'corrupt') {
      issues.push({
        code: 'content_hash_mismatch',
        sequence: checkpoint.sequence,
        contentId: checkpoint.content.contentId,
      });
    } else if (read.status === 'failed') {
      issues.push({
        code: 'content_read_failed',
        sequence: checkpoint.sequence,
        contentId: checkpoint.content.contentId,
      });
    } else if (read.bytes.byteLength !== checkpoint.content.byteLength) {
      issues.push({
        code: 'content_length_mismatch',
        sequence: checkpoint.sequence,
        contentId: checkpoint.content.contentId,
      });
    }
  }
  return addTraceReadIssues(projection, issues);
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
    if (
      parsed[key] !== undefined
      && !candidates.some((candidate) => candidate[key] === parsed[key])
    ) return false;
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
