// Builds model context parts for tool calls and tool results that continue the loop.
import type { ModelInputContextSourceRef } from '@megumi/shared/model';
import type { JsonValue } from '@megumi/shared/primitives';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';

import type { ModelInputContextPartDraft } from '../context-budget';

const TOOL_RESULT_CONTINUATION_MAX_CHARS = 12_000;

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

  const toolResultParts = orderToolResultsForContinuation(input.toolResults ?? []).map((toolResult, index): ModelInputContextPartDraft => {
    const continuation = boundedToolResultContinuation(toolResult);
    return {
      partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
      kind: 'tool_continuation',
      text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolCallId}: ${continuation.summary}`,
      toolCallId: String(toolResult.toolCallId),
      ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
      toolResultId: String(toolResult.toolResultId),
      toolResultContent: continuation.content,
      sourceRefs: [toolResultSourceRef(toolResult)],
      priority: 85,
      retentionGroupId: `tool-continuation:${toolResult.toolCallId}`,
      metadata: {
        kind: toolResult.kind,
        redactionState: toolResult.redactionState,
        ...(toolResult.observationId ? { observationId: toolResult.observationId } : {}),
        ...(toolResult.metadata?.callOrder !== undefined ? { callOrder: toolResult.metadata.callOrder } : {}),
        ...(continuation.truncated ? { contextEnvelopeTruncated: true } : {}),
      },
    };
  });

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

function boundedToolResultContinuation(toolResult: ToolResult): {
  content: string;
  summary: string;
  truncated: boolean;
} {
  const content = toolResultContent(toolResult);
  const hasObservationEnvelope = Boolean(
    toolResult.metadata?.observationTruncated !== undefined
    || toolResult.metadata?.observationRawResultRef
    || toolResult.metadata?.observationContinuationHint
    || toolResult.metadata?.observationByteLength !== undefined
  );
  const bounded = boundContinuationContent(content);

  if (!hasObservationEnvelope && !bounded.truncated) {
    return {
      content,
      summary: `${content}.`,
      truncated: false,
    };
  }

  const envelope = [
    `Observation truncated: ${readBoolean(toolResult.metadata, 'observationTruncated') ? 'true' : 'false'}`,
    ...(readString(toolResult.metadata, 'observationTruncationReason')
      ? [`Truncation reason: ${readString(toolResult.metadata, 'observationTruncationReason')}`]
      : []),
    ...(readNumber(toolResult.metadata, 'observationByteLength') !== undefined
      ? [`Original byte length: ${readNumber(toolResult.metadata, 'observationByteLength')}`]
      : []),
    ...(readNumber(toolResult.metadata, 'observationTokenEstimate') !== undefined
      ? [`Original token estimate: ${readNumber(toolResult.metadata, 'observationTokenEstimate')}`]
      : []),
    ...(readString(toolResult.metadata, 'observationRawResultRef')
      ? [`Raw result ref: ${readString(toolResult.metadata, 'observationRawResultRef')}`]
      : []),
    ...(readString(toolResult.metadata, 'observationContinuationHint')
      ? [`Continuation hint: ${readString(toolResult.metadata, 'observationContinuationHint')}`]
      : []),
    'Content:',
    bounded.content,
    ...(bounded.truncated ? ['[Context notice] Tool result content was bounded before provider continuation.'] : []),
  ].join('\n');

  return {
    content: envelope,
    summary: envelope,
    truncated: bounded.truncated,
  };
}

function boundContinuationContent(content: string): { content: string; truncated: boolean } {
  if (content.length <= TOOL_RESULT_CONTINUATION_MAX_CHARS) {
    return { content, truncated: false };
  }
  return {
    content: content.slice(0, TOOL_RESULT_CONTINUATION_MAX_CHARS),
    truncated: true,
  };
}

function readString(metadata: ToolResult['metadata'], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(metadata: ToolResult['metadata'], key: string): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' ? value : undefined;
}

function readBoolean(metadata: ToolResult['metadata'], key: string): boolean | undefined {
  const value = metadata?.[key];
  return typeof value === 'boolean' ? value : undefined;
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
