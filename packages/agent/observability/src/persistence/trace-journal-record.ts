/*
 * Defines and validates the append-only Trace Journal schema major version 1.
 */
import { z } from 'zod';
import { CapturedContentSchema } from '../content/content-contract';
import {
  RecordedOutcomeSchema,
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
    kind: z.enum([
      'input.received', 'input.processed', 'session.message.committed',
      'context.resolved', 'context.compaction.source', 'context.compaction.summary', 'prompt.final',
      'model.request', 'model.provider_request', 'model.provider_response', 'model.response',
      'tool.request', 'tool.arguments', 'tool.handler_result', 'tool.result',
      'source.request', 'source.provider_response', 'source.result',
      'discovery.material', 'discovery.candidates', 'discovery.selection',
      'discovery.recommendations', 'recommendation.published',
    ]),
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
]);

export type TraceJournalRecord = z.infer<typeof TraceJournalRecordSchema>;

