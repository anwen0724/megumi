// Owns persisted tool execution record transitions and projections.
import {
  createRawToolResultFromContent,
  normalizeToolError,
} from '../../../tools/normalization';
import { createObservationFromRawToolResult } from '../../../tools/observations';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RawToolResult, ToolExecutionRecord, ToolObservationBudgetProfile } from '@megumi/shared/tool';
import type { CodingAgentToolExecutionRunOptions } from '../../../tools/tool-execution-host-port';
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
  executionOptions?: CodingAgentToolExecutionRunOptions,
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
    const rawResult = await options.toolExecutionRouter.executeToolExecution(
      running,
      executionOptions,
    );
    const observation = createObservationFromRawToolResult({
      rawResult,
      profile: budgetProfileForRecord(running, rawResult),
      record: running,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.recordToolExecution({
      ...running,
      status: rawResult.isError ? 'failed' : 'succeeded',
      completedAt: observation.createdAt,
      rawResultRef: rawResult.rawToolResultId,
      observation,
      resultPreview: observation.content.slice(0, 500),
      ...(rawResult.isError ? { error: normalizeToolError(rawResult.content, {
        debugId: `tool-error:${running.toolExecutionId}`,
        fallbackMessage: 'Tool execution failed.',
      }) } : {}),
    });
  } catch (error) {
    const normalizedError = normalizeToolError(error, {
      debugId: `tool-error:${running.toolExecutionId}`,
      fallbackMessage: 'Tool execution failed.',
    });
    const rawResult = createRawToolResultFromContent({
      rawToolResultId: options.ids.rawToolResultId(),
      toolExecutionId: String(running.toolExecutionId),
      toolCallId: String(running.toolCallId),
      isError: true,
      outputKind: 'error',
      content: normalizedError,
      createdAt: options.now(),
    });
    const observation = createObservationFromRawToolResult({
      rawResult,
      profile: 'error',
      record: running,
      ids: options.ids,
      now: options.now,
    });
    return options.repository.recordToolExecution({
      ...running,
      status: 'failed',
      completedAt: observation.createdAt,
      rawResultRef: rawResult.rawToolResultId,
      observation,
      error: normalizedError,
      resultPreview: observation.content.slice(0, 500),
    });
  }
}

function budgetProfileForRecord(
  record: ToolExecutionRecord,
  rawResult: RawToolResult,
): ToolObservationBudgetProfile {
  if (rawResult.isError || rawResult.outputKind === 'error') {
    return 'error';
  }
  if (rawResult.outputKind === 'command' || record.toolName === 'run_command') {
    return 'commandOutput';
  }
  if (rawResult.outputKind === 'file' || record.toolName === 'read_file') {
    return 'fileRead';
  }
  return 'largeText';
}
