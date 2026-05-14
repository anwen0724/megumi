import { z } from 'zod';
import { JsonObjectSchema } from './json';

export const RUNTIME_ERROR_CODES = [
  'ipc_invalid_request',
  'ipc_handler_failed',
  'ipc_invoke_failed',
  'config_invalid',
  'provider_disabled',
  'provider_missing_api_key',
  'provider_auth_failed',
  'provider_rate_limited',
  'provider_network_error',
  'provider_unsupported',
  'database_error',
  'filesystem_error',
  'security_denied',
  'runtime_cancelled',
  'runtime_protocol_violation',
  'runtime_unknown',
  'tool_input_invalid',
  'tool_execution_failed',
  'approval_denied',
  'workspace_untrusted',
  'workspace_path_denied',
  'artifact_write_failed',
  'memory_write_failed',
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
  'memory',
  'artifact',
  'unknown',
] as const;

export type RuntimeErrorSource = (typeof RUNTIME_ERROR_SOURCES)[number];

const RUNTIME_ERROR_CODE_VALUES = [...RUNTIME_ERROR_CODES] as [
  RuntimeErrorCode,
  ...RuntimeErrorCode[],
];

const RUNTIME_ERROR_SEVERITY_VALUES = [...RUNTIME_ERROR_SEVERITIES] as [
  RuntimeErrorSeverity,
  ...RuntimeErrorSeverity[],
];

const RUNTIME_ERROR_SOURCE_VALUES = [...RUNTIME_ERROR_SOURCES] as [
  RuntimeErrorSource,
  ...RuntimeErrorSource[],
];

export const RuntimeErrorCodeSchema = z.enum(RUNTIME_ERROR_CODE_VALUES);
export const RuntimeErrorSeveritySchema = z.enum(RUNTIME_ERROR_SEVERITY_VALUES);
export const RuntimeErrorSourceSchema = z.enum(RUNTIME_ERROR_SOURCE_VALUES);

export const RuntimeErrorSchema = z
  .object({
    code: RuntimeErrorCodeSchema,
    message: z.string().min(1),
    severity: RuntimeErrorSeveritySchema,
    retryable: z.boolean(),
    source: RuntimeErrorSourceSchema,
    details: JsonObjectSchema.optional(),
    debugId: z.string().min(1).optional(),
  })
  .strict();

export type RuntimeError = z.infer<typeof RuntimeErrorSchema>;

export function isRuntimeErrorCode(value: string): value is RuntimeErrorCode {
  return (RUNTIME_ERROR_CODES as readonly string[]).includes(value);
}
