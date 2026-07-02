// Normalizes raw tool adapter output into ToolExecutionResult values.
import type {
  NormalizedToolResult,
  RawToolResult,
  ToolExecutionErrorCode,
  ToolExecutionResult,
} from '../contracts/tool-contracts';

const MAX_NORMALIZED_CONTENT_BYTES = 12_000;
const REDACTION_PATTERN = /secret[-_ ]?token/gi;

export function normalizeRawToolResult(input: {
  toolName: string;
  rawResult: RawToolResult;
}): ToolExecutionResult {
  const normalizedResult = normalizeRawContent(input.rawResult);

  return {
    type: input.rawResult.isError ? 'failed' : 'succeeded',
    toolName: input.toolName,
    ...(input.rawResult.isError
      ? {
          error: {
            code: 'tool_execution_failed' as const,
            message: normalizedResult.content || 'Tool execution failed',
          },
        }
      : { rawResult: input.rawResult }),
    normalizedResult,
    toolExecutionObservation: {
      summary: input.rawResult.isError
        ? `${input.toolName} failed`
        : `${input.toolName} completed`,
    },
  };
}

export function createFailedToolResult(input: {
  toolName?: string;
  code: ToolExecutionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): ToolExecutionResult {
  const normalizedResult = normalizeTextContent(input.message, true);
  return {
    type: 'failed',
    ...(input.toolName ? { toolName: input.toolName } : {}),
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: input.details } : {}),
    },
    normalizedResult,
    toolExecutionObservation: {
      summary: input.message,
    },
  };
}

export function createCancelledToolResult(input: {
  toolName?: string;
}): ToolExecutionResult {
  return createFailedToolResult({
    toolName: input.toolName,
    code: 'tool_cancelled',
    message: 'Tool execution was cancelled',
  });
}

function normalizeRawContent(rawResult: RawToolResult): NormalizedToolResult {
  if (rawResult.outputKind === 'json') {
    return normalizeTextContent(JSON.stringify(rawResult.content, null, 2), Boolean(rawResult.isError), 'json');
  }

  if (rawResult.outputKind === 'error') {
    return normalizeTextContent(stringifyContent(rawResult.content), true, 'error');
  }

  return normalizeTextContent(stringifyContent(rawResult.content), Boolean(rawResult.isError));
}

function normalizeTextContent(
  content: string,
  isError: boolean,
  kind: NormalizedToolResult['kind'] = isError ? 'error' : 'text',
): NormalizedToolResult {
  const redacted = redact(content);
  const truncated = Buffer.byteLength(redacted.content, 'utf8') > MAX_NORMALIZED_CONTENT_BYTES;
  const normalizedContent = truncated
    ? trimToUtf8Limit(redacted.content, MAX_NORMALIZED_CONTENT_BYTES)
    : redacted.content;

  return {
    kind,
    content: normalizedContent,
    isError,
    truncated,
    ...(truncated ? { truncationReason: 'byte_limit' as const } : {}),
    ...(redacted.redacted ? { metadata: { redactionState: 'redacted' } } : {}),
  };
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content, null, 2);
}

function redact(content: string): { content: string; redacted: boolean } {
  const redacted = content.replace(REDACTION_PATTERN, '[REDACTED]');
  return {
    content: redacted,
    redacted: redacted !== content,
  };
}

function trimToUtf8Limit(content: string, maxBytes: number): string {
  let output = content;
  while (Buffer.byteLength(output, 'utf8') > maxBytes) {
    output = output.slice(0, Math.max(0, output.length - 256));
  }
  return output;
}
