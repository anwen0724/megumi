/*
 * Owns the Agent Loop's Observability access: the Run trace and root span,
 * ModelCall/ToolCall/Approval spans, attempt and limit measurements, logs
 * and the run/session/call correlation fields. Every operation is
 * best-effort: observation failures never change the Agent Loop or Run
 * outcome, and the observer never holds business state the loop needs to
 * continue.
 */
import type { ObservabilityService, ObservabilitySpanName, SpanHandle, TraceHandle } from '@megumi/observability';
import type { Run } from './run';

export interface CreateLoopObserverOptions {
  readonly run: Run;
  readonly observability?: ObservabilityService;
}

export interface LoopObserver {
  /** Opens the Run trace and root span; never throws. */
  start(): void;
  /** Closes every open span, the root span and the trace; never throws. */
  end(status: 'ok' | 'error' | 'cancelled'): void;
  startSpan(name: ObservabilitySpanName): SpanHandle | undefined;
  endSpan(span: SpanHandle | undefined, status: 'ok' | 'error' | 'cancelled'): void;
  recordLog(input: {
    readonly level: 'info' | 'warn' | 'error';
    readonly event: string;
    readonly attributes?: Record<string, unknown>;
  }): void;
  recordMeasurement(input: {
    readonly name: string;
    readonly value: number;
    readonly unit: 'count';
    readonly attributes?: Record<string, unknown>;
  }): void;
}

export function createLoopObserver(options: CreateLoopObserverOptions): LoopObserver {
  const service = options.observability;
  let trace: TraceHandle | undefined;
  let rootSpan: SpanHandle | undefined;
  let ended = false;
  const openSpans = new Set<SpanHandle>();

  const correlation = () => ({
    ...(trace ? { traceId: trace.traceId } : {}),
    ...(rootSpan ? { spanId: rootSpan.spanId } : {}),
    runId: options.run.runId,
    sessionId: options.run.sessionId,
    workspaceId: options.run.workspaceId,
    requestId: options.run.requestId,
  });

  return {
    start() {
      if (!service || ended) return;
      try {
        trace = service.startTrace({
          traceId: options.run.runId,
          name: 'agent_run',
          runId: options.run.runId,
          sessionId: options.run.sessionId,
          workspaceId: options.run.workspaceId,
          requestId: options.run.requestId,
          attributes: {
            providerId: String(options.run.model.provider),
            modelId: options.run.model.id,
          },
        });
        rootSpan = service.runInTraceContext(trace, () => (
          service.startSpan({ name: 'agent_run' })
        ));
      } catch {
        // Diagnostics never own Run outcome.
      }
    },

    end(status) {
      if (!service || ended) return;
      ended = true;
      for (const span of [...openSpans]) {
        endSpanBestEffort(service, span, status);
      }
      openSpans.clear();
      try {
        endSpanBestEffort(service, rootSpan, status);
        if (trace) service.endTrace({ trace, status });
      } catch {
        // Diagnostics never own Run outcome.
      }
    },

    startSpan(name) {
      if (!service || ended) return undefined;
      try {
        const span = service.startSpan({ name, correlation: correlation() });
        openSpans.add(span);
        return span;
      } catch {
        return undefined;
      }
    },

    endSpan(span, status) {
      if (!service || !span || ended) return;
      if (openSpans.has(span)) openSpans.delete(span);
      endSpanBestEffort(service, span, status);
    },

    recordLog(input) {
      if (!service || ended) return;
      try {
        service.recordLog({ ...input, correlation: correlation() });
      } catch {
        // Diagnostics never own Run outcome.
      }
    },

    recordMeasurement(input) {
      if (!service || ended) return;
      try {
        service.recordMeasurement({ ...input, correlation: correlation() });
      } catch {
        // Diagnostics never own Run outcome.
      }
    },
  };
}

function endSpanBestEffort(
  service: ObservabilityService,
  span: SpanHandle | undefined,
  status: 'ok' | 'error' | 'cancelled',
): void {
  if (!span) return;
  try {
    service.endSpan({ span, status });
  } catch {
    // Diagnostics never own Run outcome.
  }
}
