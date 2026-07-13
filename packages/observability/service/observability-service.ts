/* Public write-side contract for non-blocking local diagnostics. */
import type { SpanHandle } from "../domain/model/span";
import type { TraceContext, TraceHandle } from "../domain/model/trace";
import type {
  EndSpanRequest,
  EndTraceRequest,
  RecordLogRequest,
  RecordMeasurementRequest,
  StartSpanRequest,
  StartTraceRequest,
} from "./observability-service-types";
export interface ObservabilityService {
  startTrace(request: StartTraceRequest): TraceHandle;
  endTrace(request: EndTraceRequest): void;
  startSpan(request: StartSpanRequest): SpanHandle;
  endSpan(request: EndSpanRequest): void;
  runInTraceContext<T>(trace: TraceHandle, operation: () => T): T;
  runInSpanContext<T>(span: SpanHandle, operation: () => T): T;
  getCurrentTrace(): TraceContext | undefined;
  getCurrentSpan(): TraceContext | undefined;
  recordLog(request: RecordLogRequest): void;
  recordMeasurement(request: RecordMeasurementRequest): void;
  flush(): Promise<void>;
}
