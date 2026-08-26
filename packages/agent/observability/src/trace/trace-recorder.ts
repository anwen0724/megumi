/*
 * Implements callback-scoped Trace recording while preserving business execution exactly once.
 */
import type { CapturedContent } from '../content/content-contract';
import { normalizeDiagnosticError } from '../diagnostic-error';
import type { TraceJournalRecord } from '../persistence/trace-journal-record';
import {
  createObservabilityHealth,
  type ObservabilityHealth,
} from '../runtime/observability-health';
import type {
  LinkTraceInput,
  Observability,
  OperationCompletion,
  RecordContentInput,
  SpanOptions,
  TraceOptions,
} from './observability';
import { createTraceContext, type ActiveTraceContext } from './trace-context';
import type {
  RecordedOutcome,
  TraceCorrelation,
  TraceEvent,
  TraceLinkTarget,
} from './trace-contract';

export interface TraceRecordSink {
  enqueue(record: TraceJournalRecord): void;
}

export interface TraceLinkResolver {
  resolve(target: Exclude<TraceLinkTarget, { readonly by: 'trace_id' }>): string | undefined;
}

export interface CreateTraceRecorderOptions {
  readonly enqueue: TraceRecordSink['enqueue'];
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly capture?: (input: RecordContentInput) => CapturedContent;
  readonly links?: TraceLinkResolver;
  readonly health?: ObservabilityHealth;
}

/** Creates the callback-scoped Observability writer used by product Modules. */
export function createTraceRecorder(options: CreateTraceRecorderOptions): Observability {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => crypto.randomUUID());
  const health = options.health ?? createObservabilityHealth();
  const contexts = createTraceContext();
  const activeTraces = new Map<string, ActiveTraceContext>();

  const enqueue = (context: ActiveTraceContext, record: TraceJournalRecord): void => {
    try {
      options.enqueue(record);
    } catch {
      context.lifecycle.diagnosticsDropped = true;
      health.recordDrop();
    }
  };

  const nextBase = (context: ActiveTraceContext) => ({
    schemaVersion: 1 as const,
    recordId: createId(),
    traceId: context.traceId,
    sequence: ++context.lifecycle.sequence,
    timestamp: now().toISOString(),
  });

  const observability: Observability = {
    async withTrace<T>(traceOptions: TraceOptions<T>, operation: () => Promise<T>): Promise<T> {
      let operationPromise: Promise<T> | undefined;
      const runOnce = (): Promise<T> => {
        operationPromise ??= Promise.resolve().then(operation);
        return operationPromise;
      };
      const context: ActiveTraceContext = {
        traceId: createId(),
        traceKind: traceOptions.kind,
        correlation: traceOptions.correlation ?? {},
        lifecycle: { sequence: 0, diagnosticsDropped: false },
      };
      activeTraces.set(context.traceId, context);
      try {
        return await contexts.run(context, async () => {
          enqueue(context, {
            ...nextBase(context),
            type: 'trace.started',
            traceKind: traceOptions.kind,
            correlation: context.correlation,
          });
          try {
            const result = await runOnce();
            const completion = classifyResult(traceOptions.classifyResult, result, health);
            enqueue(context, {
              ...nextBase(context),
              type: 'trace.ended',
              outcome: completion.outcome,
              ...(completion.correlation ? { correlation: completion.correlation } : {}),
              diagnostics: context.lifecycle.diagnosticsDropped ? 'dropped' : 'complete',
            });
            return result;
          } catch (error) {
            enqueue(context, {
              ...nextBase(context),
              type: 'trace.ended',
              outcome: outcomeFromError(error),
              diagnostics: context.lifecycle.diagnosticsDropped ? 'dropped' : 'complete',
            });
            throw error;
          }
        });
      } catch {
        if (operationPromise) return operationPromise;
        health.recordContextFailure();
        return runOnce();
      } finally {
        activeTraces.delete(context.traceId);
      }
    },

    async withSpan<T>(spanOptions: SpanOptions<T>, operation: () => Promise<T>): Promise<T> {
      const parent = contexts.current();
      if (!parent) return operation();
      let operationPromise: Promise<T> | undefined;
      const runOnce = (): Promise<T> => {
        operationPromise ??= Promise.resolve().then(operation);
        return operationPromise;
      };
      const spanId = createId();
      const child: ActiveTraceContext = {
        ...parent,
        correlation: mergeCorrelation(parent.correlation, spanOptions.correlation),
        currentSpanId: spanId,
      };
      enqueue(parent, {
        ...nextBase(parent),
        type: 'span.started',
        spanId,
        ...(parent.currentSpanId ? { parentSpanId: parent.currentSpanId } : {}),
        name: spanOptions.name,
        correlation: child.correlation,
      });
      try {
        return await contexts.run(child, async () => {
          try {
            const result = await runOnce();
            const completion = classifyResult(spanOptions.classifyResult, result, health);
            enqueue(parent, {
              ...nextBase(parent),
              type: 'span.ended',
              spanId,
              outcome: completion.outcome,
              ...(completion.correlation ? { correlation: completion.correlation } : {}),
            });
            return result;
          } catch (error) {
            enqueue(parent, {
              ...nextBase(parent),
              type: 'span.ended',
              spanId,
              outcome: outcomeFromError(error),
            });
            throw error;
          }
        });
      } catch {
        if (operationPromise) return operationPromise;
        health.recordContextFailure();
        return runOnce();
      }
    },

    recordContent(input): void {
      const context = contexts.current();
      if (!context) return;
      let content: CapturedContent;
      try {
        content = options.capture?.(input) ?? {
          mode: 'unavailable',
          reason: 'serialization_failed',
        };
      } catch {
        health.recordCaptureFailure();
        context.lifecycle.diagnosticsDropped = true;
        content = { mode: 'unavailable', reason: 'serialization_failed' };
      }
      enqueue(context, {
        ...nextBase(context),
        type: 'content.recorded',
        ...(context.currentSpanId ? { spanId: context.currentSpanId } : {}),
        kind: input.kind,
        content,
        correlation: mergeCorrelation(context.correlation, input.correlation),
      });
    },

    recordEvent(event: TraceEvent): void {
      const context = contexts.current();
      if (!context?.currentSpanId) return;
      enqueue(context, {
        ...nextBase(context),
        type: 'span.event',
        spanId: context.currentSpanId,
        event,
      });
    },

    linkTrace(input: LinkTraceInput): void {
      const context = contexts.current();
      if (!context) return;
      const targetTraceId = resolveLinkTarget(input.target, activeTraces, options.links);
      if (!targetTraceId || targetTraceId === context.traceId) return;
      enqueue(context, {
        ...nextBase(context),
        type: 'trace.linked',
        linkKind: input.kind,
        targetTraceId,
        ...(input.correlation ? { correlation: input.correlation } : {}),
      });
    },
  };
  return observability;
}

function classifyResult<T>(
  classifier: ((result: T) => OperationCompletion) | undefined,
  result: T,
  health: ObservabilityHealth,
): OperationCompletion {
  if (!classifier) return { outcome: { status: 'ok' } };
  try {
    return classifier(result);
  } catch {
    health.recordClassifierFailure();
    return { outcome: { status: 'unavailable', reason: 'classifier_failed' } };
  }
}

function outcomeFromError(error: unknown): RecordedOutcome {
  if (isAbortError(error)) {
    return {
      status: 'cancelled',
      ...(error instanceof Error && error.message ? { message: error.message } : {}),
    };
  }
  try {
    const normalized = normalizeDiagnosticError(error);
    return {
      status: 'error',
      code: normalized.code ?? 'operation_failed',
      message: normalized.message,
      error: normalized,
    };
  } catch {
    return { status: 'unavailable', reason: 'normalization_failed' };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function resolveLinkTarget(
  target: TraceLinkTarget,
  activeTraces: ReadonlyMap<string, ActiveTraceContext>,
  resolver: TraceLinkResolver | undefined,
): string | undefined {
  if (target.by === 'trace_id') return target.traceId;
  if (target.state === 'active') {
    return [...activeTraces.values()].find((candidate) => (
      candidate.traceKind === target.traceKind
      && correlationContains(candidate.correlation, target.correlation)
    ))?.traceId;
  }
  try {
    return resolver?.resolve(target);
  } catch {
    return undefined;
  }
}

function correlationContains(candidate: TraceCorrelation, required: TraceCorrelation): boolean {
  return required.requestId === undefined || candidate.requestId === required.requestId
    ? required.executionId === undefined || candidate.executionId === required.executionId
      ? required.batchId === undefined || candidate.batchId === required.batchId
      : false
    : false;
}

function mergeCorrelation(
  base: TraceCorrelation,
  extra: TraceCorrelation | undefined,
): TraceCorrelation {
  return extra ? { ...base, ...extra } : base;
}
