/* Defines diagnostic Span names and handles used to build Run waterfalls. */
import type { TraceContext } from "./trace";

export type ObservabilitySpanName =
  | "agent_run"
  | "context.prepare_model_call"
  | "context.compact"
  | "model.call"
  | "tool.call"
  | "approval.wait"
  | "session.append_message";

export interface SpanHandle {
  traceId?: string;
  spanId: string;
  parentSpanId?: string;
  name: ObservabilitySpanName;
  startedAtMs: number;
  context: TraceContext;
}
