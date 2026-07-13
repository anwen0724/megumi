/* Retains open diagnostic handles across separate approval resume entry points. */
import type { SpanHandle } from "../../domain/model/span";
import type { TraceHandle } from "../../domain/model/trace";

export class ActiveTraceStore {
  private readonly traces = new Map<string, TraceHandle>();
  private readonly spans = new Map<string, SpanHandle>();
  saveTrace(trace: TraceHandle): void {
    this.traces.set(trace.traceId, trace);
  }
  getTrace(traceId: string): TraceHandle | undefined {
    return this.traces.get(traceId);
  }
  removeTrace(traceId: string): void {
    this.traces.delete(traceId);
  }
  saveSpan(key: string, span: SpanHandle): void {
    this.spans.set(key, span);
  }
  takeSpan(key: string): SpanHandle | undefined {
    const span = this.spans.get(key);
    this.spans.delete(key);
    return span;
  }
}
