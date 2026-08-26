/*
 * Defines the JSON value boundary owned by Observability records and runtime logs.
 */
import { z } from 'zod';

export type DiagnosticJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DiagnosticJsonValue[]
  | { readonly [key: string]: DiagnosticJsonValue };

/** Validates a value that has already crossed Observability's capture boundary. */
export const DiagnosticJsonValueSchema: z.ZodType<DiagnosticJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(DiagnosticJsonValueSchema),
    z.record(DiagnosticJsonValueSchema),
  ]),
);

