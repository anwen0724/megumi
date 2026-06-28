// Shapes completed tool executions into facts for the next model input.
import type { ToolExecutionRecord, ToolResult } from '@megumi/shared/tool';
import type { ResolvedToolCallRunnerOptions, ToolCallRunnerOutcome } from '../tool-call-runner';
import { pendingApprovalsFromRecords } from '../approval/approval-events';
import { isTerminalForNextModelInput } from '../execution/tool-execution-window';
import { runtimeEventsFromRecords } from './tool-result-events';

export type {
  ToolResultModelInputBuildInput,
} from '../tool-call-contract';

export function nextModelInputReady(records: readonly ToolExecutionRecord[]): boolean {
  if (records.length === 0) {
    return true;
  }
  return records.every((record) => isTerminalForNextModelInput(record.status) && Boolean(record.observation));
}

export function outcomeFromRecords(
  options: ResolvedToolCallRunnerOptions,
  assistantMessageId: string,
  records: readonly ToolExecutionRecord[],
  createdAt: string,
  filter: { includeToolExecutionIds?: ReadonlySet<string> } = {},
): ToolCallRunnerOutcome {
  const eventRecords = filter.includeToolExecutionIds
    ? records.filter((record) => filter.includeToolExecutionIds?.has(String(record.toolExecutionId)))
    : records;
  const toolResults = buildToolResultsForNextModelInput(options, { records: eventRecords, createdAt });
  return {
    assistantMessageId,
    toolResults,
    pendingApprovals: pendingApprovalsFromRecords(options, records),
    runtimeEvents: runtimeEventsFromRecords(options, assistantMessageId, records, eventRecords, createdAt),
    nextModelInputReady: nextModelInputReady(records),
  };
}

export function buildToolResultsForNextModelInput(
  options: ResolvedToolCallRunnerOptions,
  input: { records: readonly ToolExecutionRecord[]; createdAt: string },
): ToolResult[] {
  return [...input.records]
    .sort((a, b) => (a.callOrder ?? 0) - (b.callOrder ?? 0))
    .filter((record) => isTerminalForNextModelInput(record.status))
    .map((record) => {
      if (!record.observation) {
        throw new Error(`Missing ToolObservation for ${record.toolExecutionId}.`);
      }
      return options.repository.saveToolResult({
        toolResultId: options.ids.toolResultId(),
        toolCallId: record.toolCallId,
        toolExecutionId: record.toolExecutionId,
        observationId: String(record.observation.observationId),
        runId: record.runId,
        kind: record.observation.isError ? 'tool_error' : 'success',
        textContent: record.observation.content,
        redactionState: 'none',
        createdAt: input.createdAt,
        metadata: {
          callOrder: record.callOrder ?? 0,
          assistantMessageId: record.assistantMessageId ?? String(record.stepId),
          observationTruncated: record.observation.truncated,
          ...(record.observation.truncationReason ? { observationTruncationReason: record.observation.truncationReason } : {}),
          ...(record.observation.rawResultRef ? { observationRawResultRef: record.observation.rawResultRef } : {}),
          ...(record.observation.continuationHint ? { observationContinuationHint: record.observation.continuationHint } : {}),
          observationByteLength: record.observation.byteLength,
          ...(record.observation.tokenEstimate !== undefined ? { observationTokenEstimate: record.observation.tokenEstimate } : {}),
        },
      });
    });
}
