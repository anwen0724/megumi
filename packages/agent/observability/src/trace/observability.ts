/*
 * Exposes the small callback-scoped write interface used by product Modules.
 */
import type { ContentKind } from '../content/content-contract';
import type {
  RecordedOutcome,
  SpanMetadata,
  SpanName,
  TraceCorrelation,
  TraceEvent,
  TraceKind,
  TraceLinkKind,
  TraceLinkTarget,
} from './trace-contract';

export interface OperationCompletion {
  readonly outcome: RecordedOutcome;
  readonly correlation?: TraceCorrelation;
}

export interface TraceOptions<T> {
  readonly kind: TraceKind;
  readonly correlation?: TraceCorrelation;
  readonly classifyResult?: (result: T) => OperationCompletion;
}

export interface SpanOptions<T> {
  readonly name: SpanName;
  readonly metadata?: SpanMetadata;
  readonly correlation?: TraceCorrelation;
  readonly classifyResult?: (result: T) => OperationCompletion;
}

export interface RecordContentInput {
  readonly kind: ContentKind;
  readonly value: unknown;
  readonly mediaType?: string;
  readonly correlation?: TraceCorrelation;
}

export interface LinkTraceInput {
  readonly kind: TraceLinkKind;
  readonly target: TraceLinkTarget;
  readonly correlation?: TraceCorrelation;
}

export interface Observability {
  /** Runs one complete product operation inside a new Trace context. */
  withTrace<T>(options: TraceOptions<T>, operation: () => Promise<T>): Promise<T>;
  /** Runs one real operation inside a child Span of the current Trace. */
  withSpan<T>(options: SpanOptions<T>, operation: () => Promise<T>): Promise<T>;
  /** Captures the actual value at one closed semantic checkpoint. */
  recordContent(input: RecordContentInput): void;
  /** Records one closed instantaneous fact on the current Span. */
  recordEvent(event: TraceEvent): void;
  /** Links the current Trace to a concrete or correlation-selected prior Trace. */
  linkTrace(input: LinkTraceInput): void;
}
