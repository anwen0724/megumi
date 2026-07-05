/*
 * Desktop IPC error contracts.
 */
import { z } from 'zod';
import {
  RuntimeErrorSchema as RuntimeIpcErrorSchema,
  type RuntimeError as RuntimeIpcError,
} from '@megumi/coding-agent/events';

export { RuntimeIpcErrorSchema, type RuntimeIpcError };

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
