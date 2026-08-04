/*
 * Host-side IPC error contract: the stable shape of a failed request between
 * the desktop shell and the renderer. Deliberately minimal — renderer only
 * reads code + message; everything else (retryable/severity/source) had no
 * consumers. Sensitive values are redacted at the boundary.
 */
import { z } from 'zod';

export const IPC_ERROR_CODES = [
  // IPC transport layer
  'ipc_invalid_request',
  'ipc_handler_failed',
  'ipc_invoke_failed',
  // Functional domains (named after current modules)
  'settings_invalid',
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
  'workspace_error',
  'workspace_path_denied',
  'permissions_denied',
  'permissions_evaluation_failed',
  'tools_system_failed',
  'tools_input_invalid',
  'tools_execution_failed',
  'engine_cancelled',
  'engine_limit_exceeded',
  'engine_cancellation_failed',
  'engine_protocol_violation',
  'engine_restarted_with_active_run',
  'context_budget_exceeded',
  'context_build_failed',
  'session_operation_failed',
  'approval_denied',
  'unknown',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export const IpcErrorCodeSchema = z.enum(IPC_ERROR_CODES);

export const IpcErrorSchema = z.object({
  code: IpcErrorCodeSchema,
  message: z.string().min(1),
  /** Optional redacted details; sensitive keys and values are stripped. */
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type IpcError = z.infer<typeof IpcErrorSchema>;

const SENSITIVE_DETAIL_KEY_PATTERN = /(?:api.?key|authorization|credential|password|secret|token|provider.?body|prompt|raw.?stack|stack|file.?content|full.?text)/i;
const SENSITIVE_DETAIL_VALUE_PATTERN = /(?:api[_-]?key\s*[=:]|authorization\s*[=:]|bearer\s+[A-Za-z0-9._-]+|password\s*[=:]|secret\s*[=:]|sk-[A-Za-z0-9_-]{8,})/i;

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> | undefined {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_DETAIL_KEY_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeValue(value);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_DETAIL_VALUE_PATTERN.test(value) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeDetails(value as Record<string, unknown>) ?? {};
  }
  return value;
}

/** Redacts sensitive keys/values so provider or file contents never cross the boundary. */
export function sanitizeIpcError(error: IpcError): IpcError {
  const details = error.details ? sanitizeDetails(error.details) : undefined;
  const message = SENSITIVE_DETAIL_VALUE_PATTERN.test(error.message)
    ? 'Unexpected error.'
    : error.message;
  return { code: error.code, message, ...(details ? { details } : {}) };
}

/** Normalizes any thrown value into a stable IpcError; unknown failures get code 'unknown'. */
export function normalizeIpcError(error: unknown, fallbackMessage: string): IpcError {
  const parsed = IpcErrorSchema.safeParse(error);
  if (parsed.success) {
    return sanitizeIpcError(parsed.data);
  }
  return {
    code: 'unknown',
    message: error instanceof Error && error.message ? error.message : fallbackMessage,
  };
}
