/* Defines Trace identity, correlation and lifecycle state. */
export type ObservabilityStatus = "ok" | "error" | "cancelled" | "incomplete";

export interface ObservabilityCorrelation {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  runId?: string;
  sessionId?: string;
  workspaceId?: string;
  requestId?: string;
}

export type TraceContext = Readonly<ObservabilityCorrelation>;

export interface TraceHandle {
  traceId: string;
  name: "agent_run";
  startedAtMs: number;
  context: TraceContext;
}
