// Normalizes raw tool adapter output into ToolExecutionResult values.
import type {
  JsonObject,
  NormalizedToolResult,
  RawToolResult,
  ToolExecutionErrorCode,
  ToolExecutionResult,
} from '../contracts/tool-contracts';

export const MAX_NORMALIZED_CONTENT_BYTES = 12_000;
const TRUNCATION_WARNING = [
  '[Megumi: this tool output exceeded the safety limit and was truncated.',
  'Do not treat the following content as complete.]',
  '',
].join('\n');
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
  const normalizedResult = normalizeRawToolContent(input.rawResult);

  if (input.rawResult.isError) {
    const error = input.rawResult.error ?? {
      code: 'tool_execution_failed' as const,
      message: `${input.toolName} failed`,
    };
    return {
      type: 'failed',
      toolName: input.toolName,
      error,
      normalizedResult: normalizeFailureContent({
        ...error,
        output: input.rawResult.content,
      }),
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
  const normalizedResult = normalizeFailureContent({
    code: input.code,
    message: input.message,
    ...(input.details ? { details: input.details } : {}),
  });
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

export function normalizeRawToolContent(rawResult: RawToolResult): NormalizedToolResult {
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
    ? TRUNCATION_WARNING + trimToUtf8Limit(
      redacted.content,
      MAX_NORMALIZED_CONTENT_BYTES - Buffer.byteLength(TRUNCATION_WARNING, 'utf8'),
    )
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
  let low = 0;
  let high = content.length;
  while (low < high) {
    let midpoint = Math.ceil((low + high) / 2);
    if (midpoint > 0 && isHighSurrogate(content.charCodeAt(midpoint - 1))) {
      midpoint -= 1;
    }
    if (Buffer.byteLength(content.slice(0, midpoint), 'utf8') <= maxBytes) {
      low = Math.max(low + 1, midpoint);
    } else {
      high = midpoint - 1;
    }
  }
  let end = Math.min(low, content.length);
  while (end > 0 && Buffer.byteLength(content.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }
  if (end > 0 && isHighSurrogate(content.charCodeAt(end - 1))) {
    end -= 1;
  }
  return content.slice(0, end);
}

function normalizeFailureContent(input: {
  code: ToolExecutionErrorCode;
  message: string;
  details?: JsonObject;
  output?: unknown;
}): NormalizedToolResult {
  return normalizeTextContent(JSON.stringify(input, null, 2), true);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
}
