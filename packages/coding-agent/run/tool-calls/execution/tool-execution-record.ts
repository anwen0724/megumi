// Provides shared projections for persisted tool execution records.
import type { RuntimeError } from '@megumi/shared/runtime';
import type { ToolExecutionRecord } from '@megumi/shared/tool';

export function runtimeErrorFromFailedRecord(record: ToolExecutionRecord): RuntimeError {
  return {
    code: record.error?.code ?? 'tool_execution_failed',
    message: record.error?.message ?? 'Tool execution failed.',
    severity: record.error?.severity ?? 'error',
    retryable: record.error?.retryable ?? false,
    source: record.error?.source ?? 'tool',
    ...(record.error?.debugId ? { debugId: record.error.debugId } : {}),
  };
}

export function recordEventPayload(record: ToolExecutionRecord) {
  return {
    assistantMessageId: record.assistantMessageId ?? String(record.stepId),
    toolExecutionId: String(record.toolExecutionId),
    toolCallId: String(record.toolCallId),
    toolName: record.toolName,
    callOrder: record.callOrder ?? 0,
    status: record.status,
  };
}
