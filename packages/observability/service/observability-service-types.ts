/* Defines requests and injected runtime capabilities used by ObservabilityService. */
import type { MeasurementUnit } from "../domain/model/measurement";
import type { ObservabilitySpanName, SpanHandle } from "../domain/model/span";
import type {
  ObservabilityCorrelation,
  ObservabilityStatus,
  TraceHandle,
} from "../domain/model/trace";

export interface ObservabilityClock {
  now(): Date;
  monotonicNowMs(): number;
}
export interface ObservabilityIdGenerator {
  nextId(): string;
}
export interface StartTraceRequest extends Omit<
  ObservabilityCorrelation,
  "traceId" | "spanId" | "parentSpanId"
> {
  traceId: string;
  name: "agent_run";
  attributes?: Record<string, unknown>;
}
export interface EndTraceRequest {
  trace: TraceHandle;
  status: Exclude<ObservabilityStatus, "incomplete">;
  attributes?: Record<string, unknown>;
}
export interface StartSpanRequest {
  name: ObservabilitySpanName;
  correlation?: ObservabilityCorrelation;
  attributes?: Record<string, unknown>;
}
export interface EndSpanRequest {
  span: SpanHandle;
  status: Exclude<ObservabilityStatus, "incomplete">;
  attributes?: Record<string, unknown>;
}
export interface RecordLogRequest {
  level: "info" | "warn" | "error";
  event: string;
  attributes?: Record<string, unknown>;
  correlation?: ObservabilityCorrelation;
}
export interface RecordMeasurementRequest {
  name: string;
  value: number;
  unit: MeasurementUnit;
  attributes?: Record<string, unknown>;
  correlation?: ObservabilityCorrelation;
}
