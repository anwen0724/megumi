// Normalizes raw tool adapter output into ToolExecutionResult values.
import type {
  JsonObject,
  NormalizedToolResult,
  RawToolResult,
  ToolExecutionErrorCode,
  ToolExecutionResult,
} from '../contracts/tool-contracts';

const MAX_NORMALIZED_CONTENT_BYTES = 12_000;
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\b(Authorization\s*:\s*Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(api[-_ ]?key|apikey|token|password|secret)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s,;]+)/gi,
  /secret[-_ ]?token/gi,
];

export function normalizeRawToolResult(input: {
  toolName: string;
  rawResult: RawToolResult;
}): ToolExecutionResult {
  const normalizedResult = normalizeRawContent(input.rawResult);

  if (input.rawResult.isError) {
    return {
      type: 'failed',
      toolName: input.toolName,
      error: {
        code: 'tool_execution_failed',
        message: normalizedResult.content || 'Tool execution failed',
      },
      normalizedResult,
      toolExecutionObservation: {
        summary: `${input.toolName} failed`,
      },
    };
  }

  return {
    type: 'succeeded',
    toolName: input.toolName,
    rawResult: input.rawResult,
    normalizedResult,
    toolExecutionObservation: {
      summary: `${input.toolName} completed`,
    },
    ...(input.rawResult.runtimeSources ? { runtimeSources: input.rawResult.runtimeSources } : {}),
  };
}

export function createFailedToolResult(input: {
  toolName?: string;
  code: ToolExecutionErrorCode;
  message: string;
  details?: JsonObject;
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
  let redacted = content;
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[0], '$1 [REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[1], '$1 [REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[2], '$1=[REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[3], '[REDACTED]');
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
