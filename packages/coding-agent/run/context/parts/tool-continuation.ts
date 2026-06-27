// Builds model context parts for tool calls and tool results that continue the loop.
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonValue } from '@megumi/shared/primitives';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';

import type { ModelInputContextPartDraft } from '../context-budget';

export interface ToolContinuationPartsInput {
  builtAt: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export function toolContinuationParts(input: ToolContinuationPartsInput): ModelInputContextPartDraft[] {
  const toolCallParts = (input.toolCalls ?? []).map((toolCall, index): ModelInputContextPartDraft => ({
    partId: `part:tool-call:${index + 1}:${toolCall.toolCallId}`,
    kind: 'tool_continuation',
    text: `Tool call ${toolCall.toolCallId} requested ${toolCall.toolName}. Input preview: ${toolCall.inputPreview.summary}.`,
    toolCallId: String(toolCall.toolCallId),
    providerToolCallId: toolCall.providerToolCallId,
    modelStepId: String(toolCall.modelStepId),
    toolName: toolCall.toolName,
    toolInput: toolCall.input,
    sourceRefs: [toolCallSourceRef(toolCall, input.builtAt)],
    priority: 80,
    retentionGroupId: `tool-continuation:${toolCall.toolCallId}`,
    metadata: {
      toolName: toolCall.toolName,
      status: toolCall.status,
    },
  }));

  const toolResultParts = orderToolResultsForContinuation(input.toolResults ?? []).map((toolResult, index): ModelInputContextPartDraft => ({
    partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
    kind: 'tool_continuation',
    text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolCallId}: ${toolResultSummary(toolResult)}.`,
    toolCallId: String(toolResult.toolCallId),
    ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
    toolResultId: String(toolResult.toolResultId),
    toolResultContent: toolResultContent(toolResult),
    sourceRefs: [toolResultSourceRef(toolResult)],
    priority: 85,
    retentionGroupId: `tool-continuation:${toolResult.toolCallId}`,
    metadata: {
      kind: toolResult.kind,
      redactionState: toolResult.redactionState,
      ...(toolResult.observationId ? { observationId: toolResult.observationId } : {}),
      ...(toolResult.metadata?.callOrder !== undefined ? { callOrder: toolResult.metadata.callOrder } : {}),
    },
  }));

  return [
    ...toolCallParts,
    ...toolResultParts,
  ];
}

function orderToolResultsForContinuation(toolResults: readonly ToolResult[]): ToolResult[] {
  return [...toolResults].sort((left, right) => {
    const leftOrder = Number(left.metadata?.callOrder ?? Number.MAX_SAFE_INTEGER);
    const rightOrder = Number(right.metadata?.callOrder ?? Number.MAX_SAFE_INTEGER);
    return leftOrder - rightOrder;
  });
}

function toolCallSourceRef(toolCall: ToolCall, loadedAt: string): ModelInputContextSourceRef {
  return {
    sourceId: `tool-call:${toolCall.toolCallId}`,
    sourceKind: 'tool_call',
    sourceUri: `tool-call://${toolCall.toolCallId}`,
    loadedAt: toolCall.createdAt ?? loadedAt,
    metadata: {
      toolName: toolCall.toolName,
      status: toolCall.status,
    },
  };
}

function toolResultSourceRef(toolResult: ToolResult): ModelInputContextSourceRef {
  return {
    sourceId: `tool-result:${toolResult.toolResultId}`,
    sourceKind: 'tool_result',
    sourceUri: `tool-result://${toolResult.toolResultId}`,
    loadedAt: toolResult.createdAt,
    metadata: {
      kind: toolResult.kind,
      redactionState: toolResult.redactionState,
    },
  };
}

function toolResultSummary(toolResult: ToolResult): string {
  if (toolResult.textContent && toolResult.textContent.trim().length > 0) {
    return toolResult.textContent;
  }
  if (toolResult.denialReason && toolResult.denialReason.trim().length > 0) {
    return toolResult.denialReason;
  }
  if (toolResult.error) {
    return toolResult.error.message;
  }
  if (toolResult.structuredContent !== undefined) {
    return stringifyJsonValue(toolResult.structuredContent);
  }
  return toolResult.kind;
}

function toolResultContent(toolResult: ToolResult): string {
  if (toolResult.textContent !== undefined) {
    return toolResult.textContent;
  }
  if (toolResult.denialReason !== undefined) {
    return toolResult.denialReason;
  }
  if (toolResult.error) {
    return toolResult.error.message;
  }
  if (toolResult.structuredContent !== undefined) {
    return stringifyJsonValue(toolResult.structuredContent);
  }
  return toolResult.kind;
}

function stringifyJsonValue(value: JsonValue): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable structured content]';
  }
}
