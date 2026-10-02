/*
 * Defines and validates the append-only Trace Journal schema major version 1.
 */
import { z } from 'zod';
import { CapturedContentSchema, ContentKindSchema } from '../content/content-contract';
import {
  RecordedOutcomeSchema,
  SpanMetadataSchema,
  SpanNameSchema,
  TraceCorrelationSchema,
  TraceEventSchema,
  TraceKindSchema,
  TraceLinkKindSchema,
} from '../trace/trace-contract';

const TraceJournalRecordBaseSchema = z.object({
  schemaVersion: z.literal(1),
  recordId: z.string().uuid(),
  traceId: z.string().uuid(),
  sequence: z.number().int().positive(),
  timestamp: z.string().datetime({ offset: true }),
});

export const TraceJournalRecordSchema = z.discriminatedUnion('type', [
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('trace.started'),
    traceKind: TraceKindSchema,
    correlation: TraceCorrelationSchema,
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('trace.linked'),
    linkKind: TraceLinkKindSchema,
    targetTraceId: z.string().uuid(),
    correlation: TraceCorrelationSchema.optional(),
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('span.started'),
    spanId: z.string().uuid(),
    parentSpanId: z.string().uuid().optional(),
    name: SpanNameSchema,
    metadata: SpanMetadataSchema.optional(),
    correlation: TraceCorrelationSchema,
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('span.event'),
    spanId: z.string().uuid(),
    event: TraceEventSchema,
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('content.recorded'),
    spanId: z.string().uuid().optional(),
    kind: ContentKindSchema,
    content: CapturedContentSchema,
    correlation: TraceCorrelationSchema,
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('span.ended'),
    spanId: z.string().uuid(),
    outcome: RecordedOutcomeSchema,
    correlation: TraceCorrelationSchema.optional(),
  }).strict(),
  TraceJournalRecordBaseSchema.extend({
    type: z.literal('trace.ended'),
    outcome: RecordedOutcomeSchema,
    correlation: TraceCorrelationSchema.optional(),
    diagnostics: z.enum(['complete', 'dropped']),
  }).strict(),
]).superRefine((record, context) => {
  if (
    record.type === 'span.started'
    && record.metadata?.kind === 'tool_call'
    && record.name !== 'tool.call'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['metadata'],
      message: 'tool_call metadata is only valid for tool.call spans.',
    });
  }
});

export type TraceJournalRecord = z.infer<typeof TraceJournalRecordSchema>;

/** Validates and encodes one schema v1 Journal Record without a trailing newline. */
export function encodeTraceJournalRecord(record: TraceJournalRecord): string {
  return JSON.stringify(TraceJournalRecordSchema.parse(record));
}

/** Parses one JSONL line and rejects unknown schema majors, fields, and invalid values. */
export function decodeTraceJournalLine(line: string): TraceJournalRecord {
  const value: unknown = JSON.parse(line);
  return TraceJournalRecordSchema.parse(value);
}
