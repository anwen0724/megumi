/* Implements non-throwing record creation and async correlation propagation. */
import type {
  ObservabilityAttributes,
  ObservabilityRecord,
} from "../domain/model/observability-record";
import type { SpanHandle } from "../domain/model/span";
import type {
  ObservabilityCorrelation,
  TraceContext,
  TraceHandle,
} from "../domain/model/trace";
import { ActiveTraceStore } from "./internal/active-trace-store";
import { ObservabilityContextStore } from "./internal/observability-context-store";
import {
  sanitizeEventName,
  sanitizeObservabilityAttributes,
} from "./internal/observability-record-sanitizer";
import type { ObservabilityService } from "./observability-service";
import type {
  EndSpanRequest,
  EndTraceRequest,
  ObservabilityClock,
  ObservabilityIdGenerator,
  RecordLogRequest,
  RecordMeasurementRequest,
  StartSpanRequest,
  StartTraceRequest,
} from "./observability-service-types";

export interface ObservabilityRecordSink {
  enqueue(record: ObservabilityRecord): void;
  flush(): Promise<void>;
}
export class ObservabilityServiceImpl implements ObservabilityService {
  private sequence = 0;
  private readonly activeTraces = new ActiveTraceStore();
  constructor(
    private readonly sink: ObservabilityRecordSink,
    private readonly clock: ObservabilityClock,
    private readonly ids: ObservabilityIdGenerator,
    private readonly contexts = new ObservabilityContextStore(),
  ) {}
  startTrace(request: StartTraceRequest): TraceHandle {
    const context: TraceContext = compact({
      traceId: request.traceId,
      runId: request.runId,
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      requestId: request.requestId,
    });
    const trace = {
      traceId: request.traceId,
      name: request.name,
      startedAtMs: this.clock.monotonicNowMs(),
      context,
    } satisfies TraceHandle;
    this.emit({
      ...this.base(context, request.attributes),
      type: "trace.started",
      name: request.name,
    });
    this.activeTraces.saveTrace(trace);
    return trace;
  }
  endTrace(request: EndTraceRequest): void {
    this.emit({
      ...this.base(request.trace.context, request.attributes),
      type: "trace.ended",
      name: request.trace.name,
      status: request.status,
      durationMs: Math.max(
        0,
        this.clock.monotonicNowMs() - request.trace.startedAtMs,
      ),
    });
    this.activeTraces.removeTrace(request.trace.traceId);
  }
  startSpan(request: StartSpanRequest): SpanHandle {
    const current = this.contexts.getCurrent();
    const spanId = this.ids.nextId();
    const context = compact({
      ...current,
      ...request.correlation,
      spanId,
      parentSpanId: request.correlation?.parentSpanId ?? current?.spanId,
    });
    const span = {
      traceId: context.traceId,
      spanId,
      parentSpanId: context.parentSpanId,
      name: request.name,
      startedAtMs: this.clock.monotonicNowMs(),
      context,
    } satisfies SpanHandle;
    this.emit({
      ...this.base(context, request.attributes),
      type: "span.started",
      name: request.name,
    });
    return span;
  }
  endSpan(request: EndSpanRequest): void {
    this.emit({
      ...this.base(request.span.context, request.attributes),
      type: "span.ended",
      name: request.span.name,
      status: request.status,
      durationMs: Math.max(
        0,
        this.clock.monotonicNowMs() - request.span.startedAtMs,
      ),
    });
  }
  runInTraceContext<T>(trace: TraceHandle, operation: () => T): T {
    return this.contexts.run(trace.context, operation);
  }
  runInSpanContext<T>(span: SpanHandle, operation: () => T): T {
    return this.contexts.run(span.context, operation);
  }
  getCurrentTrace(): TraceContext | undefined {
    const value = this.contexts.getCurrent();
    return value?.traceId ? value : undefined;
  }
  getCurrentSpan(): TraceContext | undefined {
    const value = this.contexts.getCurrent();
    return value?.spanId ? value : undefined;
  }
  recordLog(request: RecordLogRequest): void {
    this.emit({
      ...this.base(
        compact({ ...this.contexts.getCurrent(), ...request.correlation }),
        request.attributes,
      ),
      type: "log",
      level: request.level,
      event: sanitizeEventName(request.event),
    });
  }
  recordMeasurement(request: RecordMeasurementRequest): void {
    if (Number.isFinite(request.value))
      this.emit({
        ...this.base(
          compact({ ...this.contexts.getCurrent(), ...request.correlation }),
          request.attributes,
        ),
        type: "measurement",
        name: sanitizeEventName(request.name),
        value: request.value,
        unit: request.unit,
      });
  }
  async flush(): Promise<void> {
    try {
      await this.sink.flush();
    } catch {
      /* diagnostics never own product failure */
    }
  }
  private base(
    correlation: ObservabilityCorrelation,
    attributes?: Record<string, unknown>,
  ): {
    schemaVersion: 1;
    recordId: string;
    timestamp: string;
    sequence: number;
    correlation: ObservabilityCorrelation;
    attributes: ObservabilityAttributes;
  } {
    return {
      schemaVersion: 1,
      recordId: this.ids.nextId(),
      timestamp: this.clock.now().toISOString(),
      sequence: ++this.sequence,
      correlation,
      attributes: sanitizeObservabilityAttributes(attributes),
    };
  }
  private emit(record: ObservabilityRecord): void {
    try {
      this.sink.enqueue(record);
    } catch {
      /* bounded drops are intentionally non-throwing */
    }
  }
}
function compact(value: ObservabilityCorrelation): ObservabilityCorrelation {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
