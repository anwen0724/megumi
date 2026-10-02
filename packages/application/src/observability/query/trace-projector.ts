/*
 * Folds ordered Journal facts into a readable Trace while preserving diagnostic incompleteness.
 */
import type { CaptureIssue, ContentKind, CapturedContent } from '../content/content-contract';
import type { TraceJournalRecord } from '../persistence/trace-journal-record';
import type {
  RecordedOutcome,
  SpanMetadata,
  SpanName,
  TraceCorrelation,
  TraceEvent,
  TraceKind,
} from '../trace/trace-contract';
import type { TraceSummaryProjection } from './trace-query';

export type TraceReadIssueCode =
  | 'missing_trace_start'
  | 'missing_trace_end'
  | 'duplicate_trace_start'
  | 'duplicate_trace_end'
  | 'missing_span_start'
  | 'missing_span_end'
  | 'duplicate_span_start'
  | 'duplicate_span_end'
  | 'invalid_parent'
  | 'orphan_span_event'
  | 'orphan_content'
  | 'sequence_gap'
  | 'duplicate_sequence'
  | 'unknown_schema'
  | 'invalid_record'
  | 'missing_content'
  | 'content_hash_mismatch'
  | 'content_length_mismatch'
  | 'content_read_failed'
  | 'partial_content_capture'
  | 'unavailable_content'
  | 'unavailable_outcome'
  | 'diagnostics_dropped';

export interface TraceReadIssue {
  readonly code: TraceReadIssueCode;
  readonly sequence?: number;
  readonly spanId?: string;
  readonly contentId?: string;
  readonly sourceFile?: string;
  readonly contentKind?: ContentKind;
  readonly captureIssues?: readonly CaptureIssue[];
}

export interface InvalidJournalFact {
  readonly traceId: string;
  readonly sequence?: number;
  readonly issue: TraceReadIssue;
}

export interface TraceSpanProjection {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: SpanName;
  readonly metadata?: SpanMetadata;
  readonly correlation: TraceCorrelation;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcome?: RecordedOutcome;
  readonly events: readonly TraceSpanEventProjection[];
}

export interface TraceSpanEventProjection {
  readonly sequence: number;
  readonly timestamp: string;
  readonly event: TraceEvent;
}

export interface TraceContentProjection {
  readonly sequence: number;
  readonly timestamp: string;
  readonly spanId?: string;
  readonly kind: ContentKind;
  readonly content: CapturedContent;
  readonly correlation: TraceCorrelation;
}

export interface TraceLinkProjection {
  readonly sequence: number;
  readonly timestamp: string;
  readonly linkKind: 'duplicate' | 'retries' | 'continues';
  readonly targetTraceId: string;
  readonly correlation?: TraceCorrelation;
}

export interface TraceProjection {
  readonly traceId: string;
  readonly traceKind: TraceKind | 'unknown';
  readonly status: 'ok' | 'error' | 'cancelled' | 'incomplete';
  readonly diagnostics: 'complete' | 'incomplete';
  readonly correlations: readonly TraceCorrelation[];
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly recordedOutcome?: RecordedOutcome;
  readonly spans: readonly TraceSpanProjection[];
  readonly links: readonly TraceLinkProjection[];
  readonly contents: readonly TraceContentProjection[];
  readonly records: readonly TraceJournalRecord[];
  readonly issues: readonly TraceReadIssue[];
  readonly sourceFiles: readonly string[];
}

export interface ProjectTraceInput {
  readonly traceId: string;
  readonly records: readonly TraceJournalRecord[];
  readonly invalidFacts?: readonly InvalidJournalFact[];
  readonly sourceFiles?: readonly string[];
}

interface SpanFacts {
  readonly starts: Extract<TraceJournalRecord, { readonly type: 'span.started' }>[];
  readonly ends: Extract<TraceJournalRecord, { readonly type: 'span.ended' }>[];
  readonly events: Extract<TraceJournalRecord, { readonly type: 'span.event' }>[];
}

/** Projects one Trace through an explicit lifecycle state machine without inventing missing facts. */
export function projectTrace(input: ProjectTraceInput): TraceProjection {
  const records = [...input.records].sort(compareRecords);
  const issues: TraceReadIssue[] = (input.invalidFacts ?? []).map((fact) => fact.issue);
  const starts = records.filter((record) => record.type === 'trace.started');
  const ends = records.filter((record) => record.type === 'trace.ended');
  if (starts.length === 0) issues.push({ code: 'missing_trace_start' });
  if (starts.length > 1) issues.push({ code: 'duplicate_trace_start', sequence: starts[1]?.sequence });
  if (ends.length === 0) issues.push({ code: 'missing_trace_end' });
  if (ends.length > 1) issues.push({ code: 'duplicate_trace_end', sequence: ends[1]?.sequence });
  detectSequenceIssues(records, input.invalidFacts ?? [], issues);

  const spanFacts = collectSpanFacts(records, issues);
  const spans = projectSpans(spanFacts);
  const spanIds = new Set(spans.map((span) => span.spanId));
  validateSpanParents(spans, spanFacts, issues);

  const contents = records.flatMap((record): TraceContentProjection[] => {
    if (record.type !== 'content.recorded') return [];
    if (record.spanId && !spanIds.has(record.spanId)) {
      issues.push({ code: 'orphan_content', sequence: record.sequence, spanId: record.spanId });
    }
    const unavailableCaptureIssues = (
      record.content.mode === 'inline' || record.content.mode === 'stored'
    )
      ? record.content.issues?.filter((issue) => issue.kind === 'unavailable') ?? []
      : [];
    if (record.content.mode === 'unavailable') {
      issues.push({
        code: 'unavailable_content',
        sequence: record.sequence,
        contentKind: record.kind,
      });
    } else if (unavailableCaptureIssues.length > 0) {
      issues.push({
        code: 'partial_content_capture',
        sequence: record.sequence,
        contentKind: record.kind,
        ...(record.content.mode === 'stored' ? { contentId: record.content.contentId } : {}),
        captureIssues: unavailableCaptureIssues,
      });
    }
    return [{
      sequence: record.sequence,
      timestamp: record.timestamp,
      ...(record.spanId ? { spanId: record.spanId } : {}),
      kind: record.kind,
      content: record.content,
      correlation: record.correlation,
    }];
  });
  const links = records.flatMap((record): TraceLinkProjection[] => (
    record.type === 'trace.linked'
      ? [{
          sequence: record.sequence,
          timestamp: record.timestamp,
          linkKind: record.linkKind,
          targetTraceId: record.targetTraceId,
          ...(record.correlation ? { correlation: record.correlation } : {}),
        }]
      : []
  ));

  const end = ends[0];
  if (end?.outcome.status === 'unavailable') issues.push({ code: 'unavailable_outcome' });
  if (end?.diagnostics === 'dropped') issues.push({ code: 'diagnostics_dropped' });
  for (const span of spans) {
    if (span.outcome?.status === 'unavailable') {
      issues.push({ code: 'unavailable_outcome', spanId: span.spanId });
    }
  }
  const correlations = collectRecordCorrelations(records);
  const incomplete = issues.length > 0;
  return {
    traceId: input.traceId,
    traceKind: starts[0]?.traceKind ?? 'unknown',
    status: outcomeStatus(end?.outcome),
    diagnostics: incomplete ? 'incomplete' : 'complete',
    correlations,
    ...(starts[0] ? { startedAt: starts[0].timestamp } : {}),
    ...(end ? { endedAt: end.timestamp, recordedOutcome: end.outcome } : {}),
    spans,
    links,
    contents,
    records,
    issues,
    sourceFiles: [...new Set(input.sourceFiles ?? [])].sort(),
  };
}

/** Adds Reader-discovered Content evidence issues without changing the recorded business outcome. */
export function addTraceReadIssues(
  projection: TraceProjection,
  additionalIssues: readonly TraceReadIssue[],
): TraceProjection {
  if (additionalIssues.length === 0) return projection;
  return {
    ...projection,
    diagnostics: 'incomplete',
    issues: [...projection.issues, ...additionalIssues],
  };
}

/** Reduces one full projection to the metadata required by Trace list consumers. */
export function summarizeTrace(trace: TraceProjection): TraceSummaryProjection {
  return {
    traceId: trace.traceId,
    traceKind: trace.traceKind,
    status: trace.status,
    diagnostics: trace.diagnostics,
    correlations: trace.correlations,
    ...(trace.startedAt ? { startedAt: trace.startedAt } : {}),
    ...(trace.endedAt ? { endedAt: trace.endedAt } : {}),
    spanCount: trace.spans.length,
    eventCount: trace.spans.reduce((count, span) => count + span.events.length, 0),
    contentCount: trace.contents.length,
    issueCount: trace.issues.length,
  };
}

function collectSpanFacts(
  records: readonly TraceJournalRecord[],
  issues: TraceReadIssue[],
): Map<string, SpanFacts> {
  const facts = new Map<string, SpanFacts>();
  const getFacts = (spanId: string): SpanFacts => {
    const existing = facts.get(spanId);
    if (existing) return existing;
    const created: SpanFacts = { starts: [], ends: [], events: [] };
    facts.set(spanId, created);
    return created;
  };
  for (const record of records) {
    if (record.type === 'span.started') getFacts(record.spanId).starts.push(record);
    if (record.type === 'span.ended') getFacts(record.spanId).ends.push(record);
    if (record.type === 'span.event') getFacts(record.spanId).events.push(record);
  }
  for (const [spanId, value] of facts) {
    if (value.starts.length === 0) issues.push({ code: 'missing_span_start', spanId });
    if (value.starts.length > 1) {
      issues.push({ code: 'duplicate_span_start', spanId, sequence: value.starts[1]?.sequence });
    }
    if (value.ends.length === 0) issues.push({ code: 'missing_span_end', spanId });
    if (value.ends.length > 1) {
      issues.push({ code: 'duplicate_span_end', spanId, sequence: value.ends[1]?.sequence });
    }
    if (value.starts.length === 0 && value.events.length > 0) {
      issues.push({ code: 'orphan_span_event', spanId });
    }
  }
  return facts;
}

function projectSpans(facts: ReadonlyMap<string, SpanFacts>): TraceSpanProjection[] {
  return [...facts.entries()].flatMap(([spanId, value]) => {
    const start = value.starts[0];
    if (!start) return [];
    const end = value.ends[0];
    return [{
      spanId,
      ...(start.parentSpanId ? { parentSpanId: start.parentSpanId } : {}),
      name: start.name,
      ...(start.metadata ? { metadata: start.metadata } : {}),
      correlation: start.correlation,
      startedAt: start.timestamp,
      ...(end ? { endedAt: end.timestamp, outcome: end.outcome } : {}),
      events: value.events.map((record) => ({
        sequence: record.sequence,
        timestamp: record.timestamp,
        event: record.event,
      })),
    }];
  }).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function validateSpanParents(
  spans: readonly TraceSpanProjection[],
  facts: ReadonlyMap<string, SpanFacts>,
  issues: TraceReadIssue[],
): void {
  for (const span of spans) {
    if (!span.parentSpanId) continue;
    const parentStart = facts.get(span.parentSpanId)?.starts[0];
    const childStart = facts.get(span.spanId)?.starts[0];
    if (!parentStart || !childStart || parentStart.sequence >= childStart.sequence) {
      issues.push({ code: 'invalid_parent', spanId: span.spanId });
    }
  }
}

function detectSequenceIssues(
  records: readonly TraceJournalRecord[],
  invalidFacts: readonly InvalidJournalFact[],
  issues: TraceReadIssue[],
): void {
  const sequences = [
    ...records.map((record) => record.sequence),
    ...invalidFacts.flatMap((fact) => fact.sequence === undefined ? [] : [fact.sequence]),
  ].sort((left, right) => left - right);
  let previous = 0;
  for (const sequence of sequences) {
    if (sequence === previous) {
      issues.push({ code: 'duplicate_sequence', sequence });
      continue;
    }
    if (sequence !== previous + 1) {
      issues.push({ code: 'sequence_gap', sequence });
    }
    previous = sequence;
  }
}

function collectRecordCorrelations(
  records: readonly TraceJournalRecord[],
): readonly TraceCorrelation[] {
  const correlations = new Map<string, TraceCorrelation>();
  for (const record of records) {
    if ('correlation' in record && record.correlation) {
      const identity = JSON.stringify(record.correlation);
      correlations.set(identity, record.correlation);
    }
  }
  return [...correlations.values()];
}

function outcomeStatus(
  outcome: RecordedOutcome | undefined,
): 'ok' | 'error' | 'cancelled' | 'incomplete' {
  if (!outcome || outcome.status === 'unavailable') return 'incomplete';
  return outcome.status;
}

function compareRecords(left: TraceJournalRecord, right: TraceJournalRecord): number {
  return left.sequence - right.sequence
    || left.timestamp.localeCompare(right.timestamp)
    || left.recordId.localeCompare(right.recordId);
}
