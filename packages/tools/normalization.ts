import type { RuntimeError } from '@megumi/shared/runtime';
import type {
  ToolExecution,
  ToolError,
  ToolResult,
} from '@megumi/shared/tool';

export interface NormalizeToolResultInput {
  toolResultId: ToolResult['toolResultId'];
  structuredContent?: ToolResult['structuredContent'];
  textContent?: string;
  contentRefs?: ToolResult['contentRefs'];
  redactionState?: ToolResult['redactionState'];
  createdAt: ToolResult['createdAt'];
  metadata?: ToolResult['metadata'];
}

export function normalizeToolResult(
  toolExecution: Pick<ToolExecution, 'toolCallId' | 'toolExecutionId' | 'runId'>,
  input: NormalizeToolResultInput,
): ToolResult {
  return {
    toolResultId: input.toolResultId,
    toolCallId: toolExecution.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolExecution.runId,
    kind: 'success',
    ...(input.structuredContent !== undefined ? { structuredContent: input.structuredContent } : {}),
    ...(input.textContent !== undefined ? { textContent: input.textContent } : {}),
    ...(input.contentRefs ? { contentRefs: input.contentRefs } : {}),
    redactionState: input.redactionState ?? 'none',
    createdAt: input.createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function createToolInputValidationError(debugId: string, message: string): RuntimeError {
  return {
    code: 'tool_input_invalid',
    message,
    severity: 'warning',
    retryable: false,
    source: 'tool',
    debugId,
  };
}

export function normalizeToolError(
  error: unknown,
  input: {
    debugId: string;
    fallbackMessage: string;
  },
): ToolError {
  if (isRuntimeErrorLike(error)) {
    return {
      code: error.code,
      message: error.message,
      severity: error.severity,
      retryable: error.retryable,
      source: error.source,
      ...(error.debugId ? { debugId: error.debugId } : { debugId: input.debugId }),
      ...(error.details ? { detailsPreview: error.details } : {}),
    };
  }

  return {
    code: 'tool_execution_failed',
    message: error instanceof Error ? error.message : input.fallbackMessage,
    severity: 'error',
    retryable: false,
    source: 'tool',
    debugId: input.debugId,
  };
}

function isRuntimeErrorLike(value: unknown): value is RuntimeError {
  return typeof value === 'object'
    && value !== null
    && 'code' in value
    && 'message' in value
    && 'severity' in value
    && 'retryable' in value
    && 'source' in value;
}

