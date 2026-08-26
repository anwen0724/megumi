/*
 * Defines the renderer-safe Trace diagnostics contract owned by Product Host.
 * Content bodies cross this boundary only through the explicit lazy-read operation.
 */
import { z } from 'zod';

const TraceStatusSchema = z.enum(['ok', 'error', 'cancelled', 'incomplete']);
const TraceDiagnosticsSchema = z.enum(['complete', 'incomplete']);
const TraceKindSchema = z.enum(['conversation', 'daily_discovery', 'unknown']);
export interface ObservabilityDiagnosticErrorUiDto {
  readonly name: string;
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly cause?: ObservabilityDiagnosticErrorUiDto;
}
const DiagnosticErrorSchema: z.ZodType<ObservabilityDiagnosticErrorUiDto> = z.lazy(() => z.object({
  name: z.string(), message: z.string(), code: z.string().optional(),
  stack: z.string().optional(), cause: DiagnosticErrorSchema.optional(),
}).strict());
const TraceOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), code: z.string().optional() }).strict(),
  z.object({
    status: z.literal('error'), code: z.string(), message: z.string(),
    retryable: z.boolean().optional(), error: DiagnosticErrorSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal('cancelled'), code: z.string().optional(), message: z.string().optional(),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['classifier_failed', 'normalization_failed']),
  }).strict(),
]);

export const ObservabilityCorrelationSchema = z.object({
  requestId: z.string().optional(), executionId: z.string().optional(),
  sessionId: z.string().optional(), messageId: z.string().optional(),
  workspaceId: z.string().optional(), batchId: z.string().optional(),
  compactionId: z.string().optional(), modelCallId: z.string().optional(),
  toolCallId: z.string().optional(), sourceId: z.string().optional(),
  candidateId: z.string().optional(), recommendationId: z.string().optional(),
  recommendationIds: z.array(z.string()).optional(), contentId: z.string().optional(),
  contentDigest: z.string().optional(), providerAttempt: z.number().int().positive().optional(),
  discoveryAttempt: z.number().int().positive().optional(),
}).strict();
export type ObservabilityCorrelationUiDto = z.infer<typeof ObservabilityCorrelationSchema>;

export const ObservabilityListPayloadSchema = z.object({
  startedAtOrAfter: z.string().datetime({ offset: true }).optional(),
  startedBefore: z.string().datetime({ offset: true }).optional(),
  traceKind: z.enum(['conversation', 'daily_discovery']).optional(),
  status: TraceStatusSchema.optional(),
  correlation: ObservabilityCorrelationSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
export const ObservabilityTracePayloadSchema = z.object({ traceId: z.string().min(1) }).strict();
export const ObservabilityContentPayloadSchema = z.object({
  traceId: z.string().min(1), sequence: z.number().int().nonnegative(),
}).strict();
export const ObservabilityEmptyPayloadSchema = z.object({}).strict();

const CaptureIssueSchema = z.object({
  path: z.string(), kind: z.enum(['redacted', 'unavailable']), reason: z.string(),
}).strict();

export const ObservabilityTraceSummarySchema = z.object({
  traceId: z.string(), traceKind: TraceKindSchema, status: TraceStatusSchema,
  diagnostics: TraceDiagnosticsSchema, correlation: ObservabilityCorrelationSchema,
  startedAt: z.string().optional(), endedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(), spanCount: z.number().int().nonnegative(),
  eventCount: z.number().int().nonnegative(), contentCount: z.number().int().nonnegative(),
  issueCount: z.number().int().nonnegative(),
}).strict();
export type ObservabilityTraceSummaryUiDto = z.infer<typeof ObservabilityTraceSummarySchema>;

const EventDetailValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ObservabilityEventSchema = z.object({
  sequence: z.number().int().nonnegative(), timestamp: z.string(), type: z.string(),
  detail: z.record(z.string(), EventDetailValueSchema),
}).strict();
export type ObservabilityEventUiDto = z.infer<typeof ObservabilityEventSchema>;

const ObservabilitySpanSchema = z.object({
  spanId: z.string(), parentSpanId: z.string().optional(), name: z.string(),
  correlation: ObservabilityCorrelationSchema, startedAt: z.string(), endedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(), outcome: TraceOutcomeSchema.optional(),
  events: z.array(ObservabilityEventSchema),
}).strict();
export type ObservabilitySpanUiDto = z.infer<typeof ObservabilitySpanSchema>;

const ObservabilityContentCheckpointSchema = z.object({
  sequence: z.number().int().nonnegative(), timestamp: z.string(), spanId: z.string().optional(),
  kind: z.string(), mode: z.enum(['inline', 'stored', 'redacted', 'unavailable']),
  contentId: z.string().optional(), mediaType: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional(), reason: z.string().optional(),
  issues: z.array(CaptureIssueSchema).optional(), correlation: ObservabilityCorrelationSchema,
}).strict();
export type ObservabilityContentCheckpointUiDto = z.infer<typeof ObservabilityContentCheckpointSchema>;

const ObservabilityLinkSchema = z.object({
  sequence: z.number().int().nonnegative(), timestamp: z.string(),
  linkKind: z.enum(['duplicate', 'retries', 'continues']), targetTraceId: z.string(),
  correlation: ObservabilityCorrelationSchema.optional(),
}).strict();
const ObservabilityIssueSchema = z.object({
  code: z.string(), sequence: z.number().int().nonnegative().optional(),
  spanId: z.string().optional(), contentId: z.string().optional(), sourceFile: z.string().optional(),
  contentKind: z.string().optional(), captureIssues: z.array(CaptureIssueSchema).optional(),
}).strict();

export const ObservabilityTraceDetailSchema = z.object({
  summary: ObservabilityTraceSummarySchema, outcome: TraceOutcomeSchema.optional(),
  spans: z.array(ObservabilitySpanSchema), contents: z.array(ObservabilityContentCheckpointSchema),
  links: z.array(ObservabilityLinkSchema), issues: z.array(ObservabilityIssueSchema),
  sourceFiles: z.array(z.string()),
}).strict();
export type ObservabilityTraceDetailUiDto = z.infer<typeof ObservabilityTraceDetailSchema>;

export const ObservabilityListResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), traces: z.array(ObservabilityTraceSummarySchema) }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityListResult = z.infer<typeof ObservabilityListResultSchema>;
export const ObservabilityGetTraceResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), trace: ObservabilityTraceDetailSchema }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityGetTraceResult = z.infer<typeof ObservabilityGetTraceResultSchema>;

const AvailableContentSchema = z.discriminatedUnion('encoding', [
  z.object({
    encoding: z.literal('text'), contentId: z.string(), mediaType: z.string(),
    byteLength: z.number().int().nonnegative(), text: z.string(),
  }).strict(),
  z.object({
    encoding: z.literal('json'), contentId: z.string(), mediaType: z.string(),
    byteLength: z.number().int().nonnegative(), json: z.string(),
  }).strict(),
  z.object({
    encoding: z.literal('binary'), contentId: z.string(), mediaType: z.string(),
    byteLength: z.number().int().nonnegative(),
  }).strict(),
]);
export const ObservabilityGetContentResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), content: AvailableContentSchema }).strict(),
  z.object({ status: z.literal('redacted'), reason: z.string() }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.string() }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityGetContentResult = z.infer<typeof ObservabilityGetContentResultSchema>;

export const ObservabilityHealthSchema = z.object({
  droppedRecords: z.number().int().nonnegative(),
  recordsDroppedByType: z.object({
    content: z.number().int().nonnegative(), event: z.number().int().nonnegative(),
    lifecycle: z.number().int().nonnegative(), runtime: z.number().int().nonnegative(),
  }).strict(),
  contentBytesDropped: z.number().int().nonnegative(),
  writerQueueHighWaterBytes: z.number().int().nonnegative(),
  journalWriteFailures: z.number().int().nonnegative(), contentWriteFailures: z.number().int().nonnegative(),
  flushFailures: z.number().int().nonnegative(), rotationFailures: z.number().int().nonnegative(),
  retentionCleanupFailures: z.number().int().nonnegative(),
  indexProjectionFailures: z.number().int().nonnegative(), classifierFailures: z.number().int().nonnegative(),
  contextFailures: z.number().int().nonnegative(), captureFailures: z.number().int().nonnegative(),
}).strict();
export type ObservabilityHealthUiDto = z.infer<typeof ObservabilityHealthSchema>;
export const ObservabilityHealthResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), health: ObservabilityHealthSchema }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityHealthResult = z.infer<typeof ObservabilityHealthResultSchema>;
export const ObservabilityRebuildResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rebuilt') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityRebuildResult = z.infer<typeof ObservabilityRebuildResultSchema>;

export interface DiagnosticBundleFileDto {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}
export interface DiagnosticBundleDto {
  readonly suggestedDirectoryName: string;
  readonly files: readonly DiagnosticBundleFileDto[];
}
export const ObservabilityExportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), directory: z.string() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string() }).strict(),
]);
export type ObservabilityExportResult = z.infer<typeof ObservabilityExportResultSchema>;

export interface ObservabilityHost {
  listTraces(payload: z.infer<typeof ObservabilityListPayloadSchema>): Promise<ObservabilityListResult>;
  getTrace(payload: z.infer<typeof ObservabilityTracePayloadSchema>): Promise<ObservabilityGetTraceResult>;
  getContent(payload: z.infer<typeof ObservabilityContentPayloadSchema>): Promise<ObservabilityGetContentResult>;
  getHealth(payload: z.infer<typeof ObservabilityEmptyPayloadSchema>): Promise<ObservabilityHealthResult>;
  rebuildIndex(payload: z.infer<typeof ObservabilityEmptyPayloadSchema>): Promise<ObservabilityRebuildResult>;
  flush(): Promise<void>;
  exportDiagnosticBundle(
    payload: z.infer<typeof ObservabilityTracePayloadSchema>,
  ): Promise<ObservabilityExportResult>;
}
