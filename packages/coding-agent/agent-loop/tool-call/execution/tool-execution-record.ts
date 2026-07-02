// Owns persisted tool execution record transitions and projections.
import type { RuntimeError } from '@megumi/shared/runtime';
import type { ToolExecutionRecord, ToolObservation } from '@megumi/shared/tool';
import type { ToolExecutionResult } from '../../../tools';
import type { ToolExecutionRunOptions } from './tool-execution-window';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';
import { isTerminalForNextModelInput } from './tool-execution-window';

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

export async function runToolExecutionRecord(
  options: ResolvedToolCallRunnerOptions,
  record: ToolExecutionRecord,
  executionOptions?: ToolExecutionRunOptions,
): Promise<ToolExecutionRecord> {
  if (isTerminalForNextModelInput(record.status) || record.status === 'cancelled') {
    return record;
  }

  const running = options.repository.recordToolExecution({
    ...record,
    status: 'running',
    startedAt: options.now(),
  });

  try {
    const executionResult = await options.toolExecutionService.executeTool({
      toolName: running.toolName,
      input: running.input,
      ...(executionOptions?.signal ? { options: { signal: executionOptions.signal } } : {}),
    });
    const observation = observationFromExecutionResult(running, executionResult, options);
    return options.repository.recordToolExecution({
      ...running,
      status: executionResult.type === 'succeeded' ? 'succeeded' : 'failed',
      completedAt: observation.createdAt,
      observation,
      resultPreview: executionResult.toolExecutionObservation?.summary ?? observation.content.slice(0, 500),
      ...(executionResult.type === 'failed' ? { error: runtimeErrorFromToolExecutionResult(executionResult, running) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool execution failed.';
    const observation = observationFromText(running, {
      ids: options.ids,
      now: options.now,
      content: message,
      isError: true,
      truncated: false,
    });
    return options.repository.recordToolExecution({
      ...running,
      status: 'failed',
      completedAt: observation.createdAt,
      observation,
      error: {
        code: 'tool_execution_failed',
        message,
        severity: 'error',
        retryable: false,
        source: 'tool',
        debugId: `tool-error:${running.toolExecutionId}`,
      },
      resultPreview: observation.content.slice(0, 500),
    });
  }
}

function observationFromExecutionResult(
  record: ToolExecutionRecord,
  result: ToolExecutionResult,
  options: Pick<ResolvedToolCallRunnerOptions, 'ids' | 'now'>,
): ToolObservation {
  return observationFromText(record, {
    ids: options.ids,
    now: options.now,
    content: result.normalizedResult.content,
    isError: result.normalizedResult.isError,
    truncated: result.normalizedResult.truncated,
    truncationReason: result.normalizedResult.truncationReason,
    metadata: {
      ...(result.toolExecutionObservation ? { toolExecutionObservation: result.toolExecutionObservation } : {}),
      ...(result.metadata ? { toolExecutionMetadata: result.metadata } : {}),
    } as ToolObservation['metadata'],
  });
}

function observationFromText(record: ToolExecutionRecord, input: {
  ids: Pick<ResolvedToolCallRunnerOptions['ids'], 'observationId'>;
  now: () => string;
  content: string;
  isError: boolean;
  truncated: boolean;
  truncationReason?: ToolExecutionResult['normalizedResult']['truncationReason'];
  metadata?: ToolObservation['metadata'];
}): ToolObservation {
  return {
    observationId: input.ids.observationId(),
    toolExecutionId: record.toolExecutionId,
    toolCallId: record.toolCallId,
    runId: record.runId,
    stepId: record.stepId,
    kind: 'text',
    isError: input.isError,
    content: input.content,
    truncated: input.truncated,
    ...(input.truncationReason ? { truncationReason: toSharedTruncationReason(input.truncationReason) } : {}),
    byteLength: Buffer.byteLength(input.content, 'utf8'),
    tokenEstimate: Math.ceil(input.content.length / 4),
    createdAt: input.now(),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function runtimeErrorFromToolExecutionResult(
  result: Extract<ToolExecutionResult, { type: 'failed' }>,
  record: ToolExecutionRecord,
): RuntimeError {
  return {
    code: runtimeErrorCodeFromToolExecutionError(result.error.code),
    message: result.error.message,
    severity: 'error',
    retryable: false,
    source: 'tool',
    debugId: `tool-error:${record.toolExecutionId}`,
  };
}

function runtimeErrorCodeFromToolExecutionError(
  code: Extract<ToolExecutionResult, { type: 'failed' }>['error']['code'],
): RuntimeError['code'] {
  switch (code) {
    case 'invalid_tool_input':
      return 'tool_input_invalid';
    case 'unknown_tool':
    case 'tool_cancelled':
    case 'tool_execution_failed':
      return 'tool_execution_failed';
  }
}

function toSharedTruncationReason(
  reason: NonNullable<ToolExecutionResult['normalizedResult']['truncationReason']>,
): ToolObservation['truncationReason'] {
  switch (reason) {
    case 'line_limit':
      return 'lineLimit';
    case 'byte_limit':
      return 'byteLimit';
    case 'token_budget':
      return 'tokenBudget';
    case 'policy':
      return 'policy';
  }
}
