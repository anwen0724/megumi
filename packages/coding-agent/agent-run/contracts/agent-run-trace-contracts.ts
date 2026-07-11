/*
 * Agent Run trace contracts for development-time JSONL diagnostics.
 * These records are not business facts and are not persisted in SQLite.
 */

export type AgentRunTraceEventType =
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'trace.tool_set.created'
  | 'trace.prompt.built'
  | 'trace.model_call.request_payload'
  | 'trace.model_call.event_received'
  | 'trace.tool_call.requested'
  | 'trace.tool_call.executable'
  | 'trace.tool_execution.request'
  | 'trace.tool_execution.result'
  | 'trace.continuation.runtime_sources'
  | 'trace.model_call.messages_appended'
  | 'trace.loop.counters'
  | 'trace.context.snapshot_failed'
  | 'trace.runtime_event.persistence_failed';

export type AgentRunTraceRecord = {
  schema_version: 1;
  timestamp: string;
  trace_id: string;
  sequence: number;
  event_type: AgentRunTraceEventType;
  run_id?: string;
  session_id?: string;
  workspace_id?: string;
  model_call_id?: string;
  tool_call_id?: string;
  payload: Record<string, unknown>;
};

export type AgentRunTraceRecordInput = Omit<
  AgentRunTraceRecord,
  'schema_version' | 'timestamp' | 'sequence'
> & {
  timestamp?: string;
};

export type AgentRunTraceLogger = {
  record(record: AgentRunTraceRecordInput): void;
};
