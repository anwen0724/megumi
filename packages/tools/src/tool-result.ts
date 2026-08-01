/* Normalizes internal adapter output into bounded, redacted public Tool results. */

import type { JsonObject } from '@megumi/ai';
import type {
  NormalizedToolResult,
  RawToolResult,
  ToolExecutionErrorCode,
  ToolExecutionResult,
} from './tool';

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

export class ToolExecutionFailure extends Error {
  public constructor(
    message: string,
    public readonly code: ToolExecutionErrorCode = 'tool_execution_failed',
    public readonly details?: JsonObject,
  ) {
    super(message);
    this.name = 'ToolExecutionFailure';
  }
}

export function normalizeRawToolResult(input: {
  readonly toolName: string;
  readonly rawResult: RawToolResult;
}): ToolExecutionResult {
  if (input.rawResult.isError) {
    const error = input.rawResult.error ?? {
      code: 'tool_execution_failed' as const,
      message: `${input.toolName} failed`,
    };
    return {
      type: 'failed',
      toolName: input.toolName,
      error,
      normalizedResult: normalizeFailureContent({ ...error, output: input.rawResult.content }),
      observation: { summary: `${input.toolName} failed` },
      ...(input.rawResult.metadata ? { metadata: cloneJsonObject(input.rawResult.metadata) } : {}),
    ...(input.rawResult.effectReport ? { effectReport: cloneEffectReport(input.rawResult.effectReport) } : {}),
      ...(input.rawResult.effectReport ? { effectReport: cloneEffectReport(input.rawResult.effectReport) } : {}),
    };
  }

  return {
    type: 'succeeded',
    toolName: input.toolName,
    normalizedResult: normalizeRawToolContent(input.rawResult),
    observation: { summary: `${input.toolName} completed` },
    ...(input.rawResult.runtimeSources
      ? { runtimeSources: input.rawResult.runtimeSources.map(cloneRuntimeSource) }
      : {}),
    ...(input.rawResult.metadata ? { metadata: cloneJsonObject(input.rawResult.metadata) } : {}),
    ...(input.rawResult.effectReport ? { effectReport: cloneEffectReport(input.rawResult.effectReport) } : {}),
  };
}

export function createFailedToolResult(input: {
  readonly toolName?: string;
  readonly code: ToolExecutionErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
}): ToolExecutionResult {
  return {
    type: 'failed',
    ...(input.toolName ? { toolName: input.toolName } : {}),
    error: {
      code: input.code,
      message: input.message,
      ...(input.details ? { details: cloneJsonObject(input.details) } : {}),
    },
    normalizedResult: normalizeFailureContent(input),
    observation: { summary: input.message },
  };
}

export function createCancelledToolResult(input: { readonly toolName?: string }): ToolExecutionResult {
  return createFailedToolResult({
    toolName: input.toolName,
    code: 'tool_cancelled',
    message: 'Tool execution was cancelled',
  });
}

export function isSuccessfulToolExecutionResult(
  result: ToolExecutionResult,
): result is Extract<ToolExecutionResult, { type: 'succeeded' }> {
  return result.type === 'succeeded';
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

function normalizeFailureContent(input: {
  readonly code: ToolExecutionErrorCode;
  readonly message: string;
  readonly details?: JsonObject;
  readonly output?: unknown;
}): NormalizedToolResult {
  return normalizeTextContent(JSON.stringify(input, null, 2), true, 'error');
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content, null, 2);
}

function redact(content: string): { readonly content: string; readonly redacted: boolean } {
  let redacted = content;
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[0], '$1 [REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[1], '$1 [REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[2], '$1=[REDACTED]');
  redacted = redacted.replace(SECRET_VALUE_PATTERNS[3], '[REDACTED]');
  return { content: redacted, redacted: redacted !== content };
}

function trimToUtf8Limit(content: string, maxBytes: number): string {
  let low = 0;
  let high = content.length;
  while (low < high) {
    let midpoint = Math.ceil((low + high) / 2);
    if (midpoint > 0 && isHighSurrogate(content.charCodeAt(midpoint - 1))) midpoint -= 1;
    if (Buffer.byteLength(content.slice(0, midpoint), 'utf8') <= maxBytes) {
      low = Math.max(low + 1, midpoint);
    } else {
      high = midpoint - 1;
    }
  }
  let end = Math.min(low, content.length);
  while (end > 0 && Buffer.byteLength(content.slice(0, end), 'utf8') > maxBytes) end -= 1;
  if (end > 0 && isHighSurrogate(content.charCodeAt(end - 1))) end -= 1;
  return content.slice(0, end);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
}

function cloneEffectReport<T>(report: T): T {
  return JSON.parse(JSON.stringify(report)) as T;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

function cloneRuntimeSource(source: NonNullable<RawToolResult['runtimeSources']>[number]) {
  return {
    ...source,
    ...(source.metadata ? { metadata: cloneJsonObject(source.metadata) } : {}),
  };
}
