// Defines sanitized platform errors that can cross module and UI boundaries.
import { z } from 'zod';
import { JsonObjectSchema, type JsonObject } from './json';

export const ErrorSeveritySchema = z.enum(['info', 'warning', 'error', 'fatal']);
export type ErrorSeverity = z.infer<typeof ErrorSeveritySchema>;

export const ErrorSourceSchema = z.enum([
  'agent',
  'ai',
  'tools',
  'context',
  'permission',
  'workspace',
  'session',
  'artifact',
  'memory',
  'database',
  'desktop',
  'ui',
  'app',
  'shared',
  'unknown',
]);
export type ErrorSource = z.infer<typeof ErrorSourceSchema>;

export const MegumiErrorSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: ErrorSeveritySchema,
    source: ErrorSourceSchema,
    retryable: z.boolean(),
    debugId: z.string().min(1).optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict();

export interface MegumiError {
  code: string;
  message: string;
  severity: ErrorSeverity;
  source: ErrorSource;
  retryable: boolean;
  debugId?: string;
  details?: JsonObject;
}

export interface CreateMegumiErrorInput {
  code: string;
  message: string;
  severity?: ErrorSeverity;
  source?: ErrorSource;
  retryable?: boolean;
  debugId?: string;
  details?: JsonObject;
}

export function createMegumiError(input: CreateMegumiErrorInput): MegumiError {
  return MegumiErrorSchema.parse({
    code: input.code,
    message: input.message,
    severity: input.severity ?? 'error',
    source: input.source ?? 'unknown',
    retryable: input.retryable ?? false,
    debugId: input.debugId,
    details: input.details,
  });
}
