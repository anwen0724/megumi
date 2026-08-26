/*
 * Defines UI-independent read filters and results for local Trace diagnostics.
 */
import type { ContentKind } from '../content/content-contract';
import type { ContentStoreReadResult } from '../content/content-store';
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

export interface TraceReader {
  /** Lists projected Traces under stable metadata filters. */
  listTraces(query?: TraceListQuery): Promise<readonly TraceProjection[]>;
  /** Reads one full projected Trace from Journal truth. */
  getTrace(traceId: string): Promise<TraceProjection | undefined>;
  /** Reads and verifies one referenced Content blob by identity. */
  readContent(contentId: string): Promise<ContentStoreReadResult>;
  /** Rebuilds the optional Derived Index from retained Journal segments. */
  rebuildIndex(): Promise<boolean>;
}
