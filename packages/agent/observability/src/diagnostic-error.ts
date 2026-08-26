/*
 * Normalizes unknown failures into the bounded error representation shared by diagnostics.
 */
import { z } from 'zod';

export interface DiagnosticError {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly cause?: DiagnosticError;
}

/** Strict runtime schema for errors after safe normalization. */
export const DiagnosticErrorSchema: z.ZodType<DiagnosticError> = z.lazy(() =>
  z.object({
    name: z.string(),
    message: z.string(),
    code: z.string().optional(),
    stack: z.string().optional(),
    cause: DiagnosticErrorSchema.optional(),
  }).strict(),
);

/** Converts an unknown error without reading arbitrary object properties. */
export function normalizeDiagnosticError(error: unknown, remainingCauseDepth = 3): DiagnosticError {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: typeof error === 'string' ? error : 'Unknown failure.' };
  }
  const code = readStringDataProperty(error, 'code');
  const cause = remainingCauseDepth > 1
    ? readErrorDataProperty(error, 'cause')
    : undefined;
  return {
    name: error.name || 'Error',
    message: error.message,
    ...(code ? { code } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
    ...(cause ? { cause: normalizeDiagnosticError(cause, remainingCauseDepth - 1) } : {}),
  };
}

function readStringDataProperty(error: Error, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
    ? descriptor.value
    : undefined;
}

function readErrorDataProperty(error: Error, key: string): Error | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  return descriptor && 'value' in descriptor && descriptor.value instanceof Error
    ? descriptor.value
    : undefined;
}

