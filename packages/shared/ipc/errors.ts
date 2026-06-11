import { z } from 'zod';
export {
  RUNTIME_ERROR_CODES as RUNTIME_IPC_ERROR_CODES,
  RUNTIME_ERROR_SEVERITIES as RUNTIME_IPC_ERROR_SEVERITIES,
  RUNTIME_ERROR_SOURCES as RUNTIME_IPC_ERROR_SOURCES,
  RuntimeErrorCodeSchema as RuntimeIpcErrorCodeSchema,
  RuntimeErrorSeveritySchema as RuntimeIpcErrorSeveritySchema,
  RuntimeErrorSourceSchema as RuntimeIpcErrorSourceSchema,
  RuntimeErrorSchema as RuntimeIpcErrorSchema,
  isRuntimeErrorCode as isRuntimeIpcErrorCode,
} from '../runtime/errors';
export type {
  RuntimeError as RuntimeIpcError,
  RuntimeErrorCode as RuntimeIpcErrorCode,
  RuntimeErrorSeverity as RuntimeIpcErrorSeverity,
  RuntimeErrorSource as RuntimeIpcErrorSource,
} from '../runtime/errors';

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

