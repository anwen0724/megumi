/*
 * Public runtime context and error contracts for host/runtime boundaries.
 * Unknown failures keep correlation identity while raw exception details stay private.
 */
import { z } from 'zod';
import {
  JsonObjectSchema,
  type JsonObject,
  type JsonValue,
} from '@megumi/ai';
import {
  IsoDateTimeSchema,
  RuntimeDebugIdSchema,
  RuntimeIdSchema,
  RuntimeOperationNameSchema,
  RuntimeSourceSchema,
  RuntimeTraceIdSchema,
  type RuntimeSource,
} from './internal/runtime-validation';

export type IsoDateTime = string;

export const RuntimeContextSchema = z.object({
  requestId: RuntimeIdSchema,
  traceId: RuntimeTraceIdSchema,
  debugId: RuntimeDebugIdSchema.optional(),
  operationName: RuntimeOperationNameSchema,
  source: RuntimeSourceSchema,
  createdAt: IsoDateTimeSchema,
}).strict();

export type RuntimeContext = z.infer<typeof RuntimeContextSchema>;

export const RuntimeResultMetaSchema = z.object({
  requestId: RuntimeIdSchema.optional(),
  traceId: RuntimeTraceIdSchema.optional(),
  debugId: RuntimeDebugIdSchema.optional(),
  operationName: RuntimeOperationNameSchema.optional(),
  handledAt: IsoDateTimeSchema,
  durationMs: z.number().nonnegative().optional(),
}).strict();

export type RuntimeResultMeta = z.infer<typeof RuntimeResultMetaSchema>;

export interface CreateRuntimeContextInput {
  requestId: string;
  traceId?: string;
  debugId?: string;
  operationName: string;
  source: RuntimeSource;
  createdAt?: IsoDateTime;
}

function createRuntimeId(prefix: 'trace' | 'debug'): string {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

export function createRuntimeTraceId(): string {
  return createRuntimeId('trace');
}

export function createRuntimeDebugId(): string {
  return createRuntimeId('debug');
}

export function createRuntimeContext(input: CreateRuntimeContextInput): RuntimeContext {
  return RuntimeContextSchema.parse({
    requestId: input.requestId,
    traceId: input.traceId ?? createRuntimeTraceId(),
    ...(input.debugId ? { debugId: input.debugId } : {}),
    operationName: input.operationName,
    source: input.source,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
}

export const RUNTIME_ERROR_CODES = [
  'ipc_invalid_request',
  'ipc_handler_failed',
  'ipc_invoke_failed',
  'config_invalid',
  'provider_disabled',
  'provider_missing_api_key',
  'provider_auth_failed',
  'provider_forbidden',
  'provider_rate_limited',
  'provider_invalid_model',
  'provider_invalid_request',
  'provider_network_error',
  'provider_unavailable',
  'provider_timeout',
  'provider_failed',
  'provider_response_invalid',
  'provider_output_truncated',
  'provider_termination_unconfirmed',
  'provider_unsupported',
  'database_error',
  'filesystem_error',
  'security_denied',
  'runtime_cancelled',
  'context_budget_exceeded',
  'context_build_failed',
  'session_operation_failed',
  'permission_evaluation_failed',
  'tool_system_failed',
  'runtime_limit_exceeded',
  'runtime_cancellation_failed',
  'runtime_protocol_violation',
  'runtime_restarted_with_active_run',
  'runtime_unknown',
  'tool_registry_snapshot_missing',
  'tool_input_invalid',
  'tool_execution_failed',
  'approval_denied',
  'workspace_untrusted',
  'workspace_path_denied',
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export const RUNTIME_ERROR_SEVERITIES = ['info', 'warning', 'error'] as const;
export type RuntimeErrorSeverity = (typeof RUNTIME_ERROR_SEVERITIES)[number];

export const RUNTIME_ERROR_SOURCES = [
  'renderer',
  'preload',
  'main',
  'core',
  'provider',
  'config',
  'database',
  'filesystem',
  'security',
  'tool',
  'approval',
  'workspace',
  'unknown',
] as const;

export type RuntimeErrorSource = (typeof RUNTIME_ERROR_SOURCES)[number];

export const RuntimeErrorCodeSchema = z.enum(RUNTIME_ERROR_CODES);
export const RuntimeErrorSeveritySchema = z.enum(RUNTIME_ERROR_SEVERITIES);
export const RuntimeErrorSourceSchema = z.enum(RUNTIME_ERROR_SOURCES);

export const RuntimeErrorSchema = z.object({
  code: RuntimeErrorCodeSchema,
  message: z.string().min(1),
  severity: RuntimeErrorSeveritySchema,
  retryable: z.boolean(),
  source: RuntimeErrorSourceSchema,
  details: JsonObjectSchema.optional(),
  debugId: z.string().min(1).optional(),
}).strict();

export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

export function isRuntimeErrorCode(value: string): value is RuntimeErrorCode {
  return (RUNTIME_ERROR_CODES as readonly string[]).includes(value);
}

export interface RuntimeExceptionOptions {
  cause?: unknown;
}

export interface NormalizeRuntimeErrorOptions {
  source: RuntimeErrorSource;
  debugId: string;
  fallbackMessage?: string;
}

export class RuntimeException extends Error {
  public readonly runtimeError: RuntimeError;
  public override readonly cause?: unknown;

  public constructor(runtimeError: RuntimeError, options: RuntimeExceptionOptions = {}) {
    super(runtimeError.message);
    this.name = 'RuntimeException';
    this.runtimeError = RuntimeErrorSchema.parse(runtimeError);
    this.cause = options.cause;
  }

  public toRuntimeError(): RuntimeError {
    return this.runtimeError;
  }
}

const SENSITIVE_DETAIL_KEY_PATTERN = /(?:api.?key|authorization|credential|password|secret|token|provider.?body|prompt|raw.?stack|stack|file.?content|full.?text)/i;
const SENSITIVE_DETAIL_VALUE_PATTERN = /(?:api[_-]?key\s*[=:]|authorization\s*[=:]|bearer\s+[A-Za-z0-9._-]+|password\s*[=:]|secret\s*[=:]|sk-[A-Za-z0-9_-]{8,})/i;

function sanitizeRuntimeErrorDetails(details: JsonObject): JsonObject | undefined {
  const sanitized: JsonObject = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEY_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeRuntimeErrorDetailValue(value);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeRuntimeErrorDetailValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    return SENSITIVE_DETAIL_VALUE_PATTERN.test(value) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeRuntimeErrorDetailValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeRuntimeErrorDetails(value) ?? {};
  }
  return value;
}

export function sanitizeRuntimeError(error: RuntimeError, fallbackMessage?: string): RuntimeError {
  const details = error.details ? sanitizeRuntimeErrorDetails(error.details) : undefined;
  const message = SENSITIVE_DETAIL_VALUE_PATTERN.test(error.message)
    ? fallbackMessage ?? 'Unexpected runtime error.'
    : error.message;
  return {
    ...error,
    message,
    ...(details ? { details } : { details: undefined }),
  };
}

export function normalizeRuntimeError(error: unknown, options: NormalizeRuntimeErrorOptions): RuntimeError {
  if (error instanceof RuntimeException) {
    return sanitizeRuntimeError(error.toRuntimeError(), options.fallbackMessage);
  }

  const parsed = RuntimeErrorSchema.safeParse(error);
  if (parsed.success) {
    return sanitizeRuntimeError(parsed.data, options.fallbackMessage);
  }

  return {
    code: 'runtime_unknown',
    message: options.fallbackMessage ?? 'Unexpected runtime error.',
    severity: 'error',
    retryable: true,
    source: options.source,
    debugId: options.debugId,
  };
}

export function createRuntimeErrorFromUnknown(
  error: unknown,
  fallbackMessage = 'Agent run failed.',
): RuntimeError {
  return normalizeRuntimeError(error, {
    source: 'core',
    debugId: createRuntimeDebugId(),
    fallbackMessage,
  });
}

export interface RuntimeEventContextBuildFailure {
  message: string;
  retryable: false;
}

export function modelCallInputBuildFailureToRuntimeError(
  failure: RuntimeEventContextBuildFailure,
): RuntimeError {
  return {
    code: 'context_budget_exceeded',
    message: failure.message,
    severity: 'error',
    retryable: failure.retryable,
    source: 'main',
  };
}

export function throwRuntimeError(error: RuntimeError): never {
  throw new RuntimeException(error);
}

export function assertRuntime(condition: unknown, error: RuntimeError): asserts condition {
  if (!condition) {
    throwRuntimeError(error);
  }
}

export {
  IsoDateTimeSchema,
  RuntimeDebugIdSchema,
  RuntimeIdSchema,
  RuntimeOperationNameSchema,
  RuntimeSourceSchema,
  RuntimeTraceIdSchema,
  type RuntimeSource,
};
