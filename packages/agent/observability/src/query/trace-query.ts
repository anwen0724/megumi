/*
 * Defines UI-independent read filters and results for local Trace diagnostics.
 */
import type { ContentKind } from '../content/content-contract';
import type { ContentStoreReadResult } from '../content/content-store';
import type { ObservabilityHealthSnapshot } from '../runtime/observability-health';
import type { TraceDiagnosticBundle } from './diagnostic-bundle';
import type { SpanName, TraceCorrelation, TraceKind } from '../trace/trace-contract';
import type { TraceProjection } from './trace-projector';

export interface TraceListQuery {
  readonly startedAtOrAfter?: string;
  readonly startedBefore?: string;
  readonly traceKind?: TraceKind;
  readonly status?: TraceProjection['status'];
  readonly spanName?: SpanName;
  readonly contentKind?: ContentKind;
  readonly correlation?: TraceCorrelation;
  readonly limit?: number;
}

export interface TraceSummaryProjection {
  readonly traceId: string;
  readonly traceKind: TraceProjection['traceKind'];
  readonly status: TraceProjection['status'];
  readonly diagnostics: TraceProjection['diagnostics'];
  readonly correlations: TraceProjection['correlations'];
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly spanCount: number;
  readonly eventCount: number;
  readonly contentCount: number;
  readonly issueCount: number;
}

export interface TraceReader {
  /** Lists bounded Trace summaries without loading captured Content bodies. */
  listTraces(query?: TraceListQuery): Promise<readonly TraceSummaryProjection[]>;
  /** Reads one full projected Trace from Journal truth. */
  getTrace(traceId: string): Promise<TraceProjection | undefined>;
  /** Reads and verifies one referenced Content blob by identity. */
  readContent(contentId: string): Promise<ContentStoreReadResult>;
  /** Rebuilds the optional Derived Index from retained Journal segments. */
  rebuildIndex(): Promise<boolean>;
}

export type CreateTraceDiagnosticBundleResult =
  | { readonly status: 'created'; readonly bundle: TraceDiagnosticBundle }
  | { readonly status: 'not_found' }
  | { readonly status: 'failed' };

export interface ObservabilityQueries extends TraceReader {
  /** Returns process-local diagnostic health without reading business state. */
  getHealth(): ObservabilityHealthSnapshot;
  /** Builds one explicitly requested single-Trace export bundle. */
  createDiagnosticBundle(traceId: string): Promise<CreateTraceDiagnosticBundleResult>;
}
