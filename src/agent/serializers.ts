// Serializes Agent-owned message facts across session and run metadata JSON boundaries.
import type { AssistantMessage } from '../ai';
import type { ContextMessageFact, ContextToolResultMessageFact } from '../context';
import type { JsonObject, JsonValue } from '../shared';
import type { ToolCall } from '../tools';
import type { AgentApprovalWaitState } from './types';

export function serializeAssistantMessageForSession(message: AssistantMessage): JsonObject {
  return stripUndefined({
    role: message.role,
    content: message.content as unknown as JsonValue,
    stopReason: message.stopReason,
    usage: message.usage as unknown as JsonValue,
    error: message.error as unknown as JsonValue,
  });
}

export function serializeToolResultMessageForSession(message: ContextToolResultMessageFact): JsonObject {
  return stripUndefined({
    id: message.id,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    status: message.status,
    content: message.content,
    error: message.error,
    metadata: message.metadata,
    redaction: message.redaction,
    truncation: message.truncation,
    createdAt: message.createdAt,
  });
}

export function serializeApprovalWaitStateForRunMetadata(waiting: AgentApprovalWaitState): JsonObject {
  return {
    pendingApproval: {
      approvalRequestId: waiting.approvalRequestId,
      runId: waiting.runId,
      turnIndex: waiting.turnIndex,
      processedToolCallCount: waiting.processedToolCallCount,
      toolCall: serializeToolCall(waiting.toolCall),
      currentRunMessages: waiting.currentRunMessages.map(serializeContextMessageFact),
      toolResultMessages: waiting.toolResultMessages.map(serializeToolResultMessageForSession),
    },
  };
}

export function parseApprovalWaitStateFromRunMetadata(metadata: JsonObject | undefined): AgentApprovalWaitState | undefined {
  const pending = metadata?.pendingApproval;
  if (!isJsonObject(pending)) {
    return undefined;
  }

  const approvalRequestId = pending.approvalRequestId;
  const runId = pending.runId;
  const turnIndex = pending.turnIndex;
  const processedToolCallCount = pending.processedToolCallCount;
  const toolCall = pending.toolCall;
  const currentRunMessages = pending.currentRunMessages;
  const toolResultMessages = pending.toolResultMessages;

  if (
    typeof approvalRequestId !== 'string'
    || typeof runId !== 'string'
    || typeof turnIndex !== 'number'
    || typeof processedToolCallCount !== 'number'
    || !isToolCall(toolCall)
    || !Array.isArray(currentRunMessages)
    || !Array.isArray(toolResultMessages)
  ) {
    return undefined;
  }

  const currentRunMessageValues: unknown[] = currentRunMessages;
  const toolResultMessageValues: unknown[] = toolResultMessages;
  const parsedCurrentRunMessages = currentRunMessageValues.filter(isContextMessageFact);
  const parsedToolResultMessages = toolResultMessageValues.filter(isContextToolResultMessageFact);
  if (parsedCurrentRunMessages.length !== currentRunMessageValues.length
    || parsedToolResultMessages.length !== toolResultMessageValues.length) {
    return undefined;
  }

  return {
    approvalRequestId,
    runId,
    turnIndex,
    processedToolCallCount,
    toolCall,
    currentRunMessages: parsedCurrentRunMessages,
    toolResultMessages: parsedToolResultMessages,
  };
}

function serializeToolCall(call: ToolCall): JsonObject {
  return {
    id: call.id,
    name: call.name,
    input: call.input,
  };
}

function serializeContextMessageFact(fact: ContextMessageFact): JsonObject {
  return stripUndefined({
    id: fact.id,
    source: fact.source,
    message: fact.message as unknown as JsonValue,
    metadata: fact.metadata,
  });
}

function stripUndefined(value: Record<string, JsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolCall(value: unknown): value is ToolCall {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && isJsonObject(value.input);
}

function isContextMessageFact(value: unknown): value is ContextMessageFact {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && (value.source === 'session' || value.source === 'current_run')
    && isJsonObject(value.message)
    && typeof value.message.role === 'string';
}

function isContextToolResultMessageFact(value: unknown): value is ContextToolResultMessageFact {
  return isJsonObject(value)
    && typeof value.id === 'string'
    && typeof value.toolCallId === 'string'
    && typeof value.toolName === 'string'
    && (value.status === 'success'
      || value.status === 'error'
      || value.status === 'rejected'
      || value.status === 'awaiting_approval')
    && typeof value.content === 'string'
    && typeof value.createdAt === 'string';
}
