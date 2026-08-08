/* Desktop-owned IPC error contract and boundary sanitization. */
import { z } from 'zod';

export const RUNTIME_IPC_ERROR_CODES = [
  'ipc_invalid_request',
  'ipc_handler_failed',
  'ipc_invoke_failed',
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

export const RuntimeIpcErrorSchema = z.object({
  code: z.enum(RUNTIME_IPC_ERROR_CODES),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
}).strict();

export type RuntimeIpcError = z.infer<typeof RuntimeIpcErrorSchema>;

const SENSITIVE_KEY = /(?:api.?key|authorization|credential|password|secret|token|provider.?body|prompt|raw.?stack|stack|file.?content|full.?text)/i;
const SENSITIVE_VALUE = /(?:api[_-]?key\s*[=:]|authorization\s*[=:]|bearer\s+[A-Za-z0-9._-]+|password\s*[=:]|secret\s*[=:]|sk-[A-Za-z0-9_-]{8,})/i;

/** Normalizes any thrown value into the Desktop IPC failure contract. */
export function normalizeRuntimeIpcError(
  error: unknown,
  fallbackMessage: string,
): RuntimeIpcError {
  const parsed = RuntimeIpcErrorSchema.safeParse(error);
  if (parsed.success) return sanitizeRuntimeIpcError(parsed.data);
  return {
    code: 'unknown',
    message: error instanceof Error && error.message ? error.message : fallbackMessage,
  };
}

/** Removes credentials, prompt text, file contents, and stack data at the IPC boundary. */
export function sanitizeRuntimeIpcError(error: RuntimeIpcError): RuntimeIpcError {
  const details = error.details ? sanitizeDetails(error.details) : undefined;
  return {
    code: error.code,
    message: SENSITIVE_VALUE.test(error.message) ? 'Unexpected error.' : error.message,
    ...(details ? { details } : {}),
  };
}

export interface SanitizedZodIssue {
  path: string;
  code: string;
  message: string;
}

export interface SanitizedZodIssues {
  issueCount: number;
  issues: SanitizedZodIssue[];
}

export function sanitizeZodIssues(error: z.ZodError): SanitizedZodIssues {
  return {
    issueCount: error.issues.length,
    issues: error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.map(String).join('.') || '<root>',
      code: issue.code,
      message: issue.message,
    })),
  };
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> | undefined {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!SENSITIVE_KEY.test(key)) sanitized[key] = sanitizeValue(value);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    return sanitizeDetails(value as Record<string, unknown>) ?? {};
  }
  return value;
}
