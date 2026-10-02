/*
 * Defines the independent strict schema major v1 Runtime Log protocol.
 */
import { z } from 'zod';
import { DiagnosticErrorSchema } from '../diagnostic-error';
import { DiagnosticJsonValueSchema } from '../diagnostic-value';
import { TraceCorrelationSchema } from '../trace/trace-contract';

export const RuntimeLogEntrySchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  module: z.string().min(1).max(128),
  code: z.string().min(1).max(128),
  message: z.string().min(1),
  correlation: TraceCorrelationSchema.optional(),
  traceId: z.string().uuid().optional(),
  spanId: z.string().uuid().optional(),
  error: DiagnosticErrorSchema.optional(),
  data: DiagnosticJsonValueSchema.optional(),
}).strict();

export type RuntimeLogEntry = z.infer<typeof RuntimeLogEntrySchema>;

/** Validates and encodes one Runtime Log entry without a trailing newline. */
export function encodeRuntimeLogEntry(entry: RuntimeLogEntry): string {
  return JSON.stringify(RuntimeLogEntrySchema.parse(entry));
}

/** Parses one Runtime JSONL line under the strict schema major v1 boundary. */
export function decodeRuntimeLogLine(line: string): RuntimeLogEntry {
  const value: unknown = JSON.parse(line);
  return RuntimeLogEntrySchema.parse(value);
}
