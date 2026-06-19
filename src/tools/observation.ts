// Shapes ToolResult values into model-consumable observations without owning AI message contracts.
import type { PolicyDecision } from '../permission';
import type { JsonObject, JsonValue } from '../shared';
import type { ToolResult } from './types';

export interface ToolResultObservation {
  toolCallId: string;
  toolName: string;
  status: ToolResult['status'];
  content: string;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: JsonObject;
  };
  metadata?: JsonObject;
  redaction?: JsonObject;
  truncation?: JsonObject;
}

export interface ToolResultObservationOptions {
  metadata?: JsonObject;
  redaction?: JsonObject;
  truncation?: JsonObject;
}

export function shapeToolResultObservation(
  result: ToolResult,
  options: ToolResultObservationOptions = {},
): ToolResultObservation {
  const base = {
    toolCallId: result.toolCallId,
    toolName: result.toolName,
    status: result.status,
    ...(options.metadata ? { metadata: options.metadata } : {}),
    ...(options.redaction ? { redaction: options.redaction } : {}),
    ...(options.truncation ? { truncation: options.truncation } : {}),
  };

  switch (result.status) {
    case 'success':
      return {
        ...base,
        content: result.text,
        metadata: mergeMetadata(options.metadata, { hasData: result.data !== undefined }),
      };
    case 'error':
      return {
        ...base,
        content: `Tool ${result.toolName} failed: ${result.error.message}`,
        error: result.error,
      };
    case 'rejected':
      return {
        ...base,
        content: `Tool ${result.toolName} was rejected: ${result.text}`,
        metadata: mergeMetadata(options.metadata, decisionMetadata(result.decision)),
      };
    case 'awaiting_approval':
      return {
        ...base,
        content: `Tool ${result.toolName} is awaiting approval: ${result.text}`,
        metadata: mergeMetadata(options.metadata, {
          ...decisionMetadata(result.decision),
          ...(result.approvalRequestId ? { approvalRequestId: result.approvalRequestId } : {}),
        }),
      };
  }
}

function decisionMetadata(decision: PolicyDecision): JsonObject {
  return {
    decisionKind: decision.kind,
    reason: decision.reason,
    operation: decision.operation,
    ...(decision.target ? { target: decision.target } : {}),
    ...(decision.command ? { command: decision.command } : {}),
    riskLevel: decision.risk.level,
    riskReasons: decision.risk.reasons,
  };
}

function mergeMetadata(left: JsonObject | undefined, right: Record<string, JsonValue>): JsonObject {
  return {
    ...(left ?? {}),
    ...right,
  };
}
