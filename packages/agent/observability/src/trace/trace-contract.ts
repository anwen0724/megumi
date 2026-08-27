/*
 * Defines the closed Trace lifecycle, correlation, event, link, and outcome contracts.
 */
import { z } from 'zod';
import { DiagnosticErrorSchema, type DiagnosticError } from '../diagnostic-error';

export const TraceKindSchema = z.enum(['conversation', 'daily_recommendation', 'candidate_supply']);
export type TraceKind = z.infer<typeof TraceKindSchema>;

export const TRACE_SPAN_NAMES = [
  'model.resolve',
  'input.process',
  'session.resolve',
  'session.create',
  'session.branch.resolve',
  'session.branch.commit',
  'session.message.commit',
  'recommendation.reference.resolve',
  'agent.execution',
  'context.build',
  'context.resolve',
  'context.compact',
  'prompt.build',
  'model.call',
  'tool.call',
  'permission.await',
  'discovery.preflight',
  'source.availability.check',
  'discovery.batch.claim',
  'discovery.attempt',
  'source.search',
  'source.read',
  'discovery.selection',
  'discovery.attempt.settle',
  'candidate.supply.check',
  'candidate.admission.commit',
  'candidate.pool.snapshot',
  'daily.batch.claim',
  'daily.attempt.settle',
  'recommendation.publish',
] as const;

export const SpanNameSchema = z.enum(TRACE_SPAN_NAMES);
export type SpanName = z.infer<typeof SpanNameSchema>;

export const SpanMetadataSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool_call'),
    toolName: z.string().min(1),
  }).strict(),
]);
export type SpanMetadata = z.infer<typeof SpanMetadataSchema>;

export const TraceLinkKindSchema = z.enum(['duplicate', 'retries', 'continues']);
export type TraceLinkKind = z.infer<typeof TraceLinkKindSchema>;

export interface TraceCorrelation {
  readonly requestId?: string;
  readonly executionId?: string;
  readonly sessionId?: string;
  readonly messageId?: string;
  readonly workspaceId?: string;
  readonly batchId?: string;
  readonly compactionId?: string;
  readonly modelCallId?: string;
  readonly toolCallId?: string;
  readonly sourceId?: string;
  readonly candidateId?: string;
  readonly recommendationId?: string;
  readonly recommendationIds?: readonly string[];
  readonly contentId?: string;
  readonly contentDigest?: string;
  readonly providerAttempt?: number;
  readonly discoveryAttempt?: number;
}

export const TraceCorrelationSchema: z.ZodType<TraceCorrelation> = z.object({
  requestId: z.string().optional(),
  executionId: z.string().optional(),
  sessionId: z.string().optional(),
  messageId: z.string().optional(),
  workspaceId: z.string().optional(),
  batchId: z.string().optional(),
  compactionId: z.string().optional(),
  modelCallId: z.string().optional(),
  toolCallId: z.string().optional(),
  sourceId: z.string().optional(),
  candidateId: z.string().optional(),
  recommendationId: z.string().optional(),
  recommendationIds: z.array(z.string()).optional(),
  contentId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  providerAttempt: z.number().int().positive().optional(),
  discoveryAttempt: z.number().int().positive().optional(),
}).strict();

export type RecordedOutcome =
  | { readonly status: 'ok'; readonly code?: string }
  | {
      readonly status: 'error';
      readonly code: string;
      readonly message: string;
      readonly retryable?: boolean;
      readonly error?: DiagnosticError;
    }
  | { readonly status: 'cancelled'; readonly code?: string; readonly message?: string }
  | { readonly status: 'unavailable'; readonly reason: 'classifier_failed' | 'normalization_failed' };

export const RecordedOutcomeSchema: z.ZodType<RecordedOutcome> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), code: z.string().optional() }).strict(),
  z.object({
    status: z.literal('error'),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    error: DiagnosticErrorSchema.optional(),
  }).strict(),
  z.object({
    status: z.literal('cancelled'),
    code: z.string().optional(),
    message: z.string().optional(),
  }).strict(),
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['classifier_failed', 'normalization_failed']),
  }).strict(),
]);

export const TraceEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('context.compaction.triggered'),
    compactionId: z.string(),
    trigger: z.enum(['threshold', 'overflow', 'manual']),
  }).strict(),
  z.object({
    type: z.literal('context.compaction.persisted'),
    compactionId: z.string(),
    messageId: z.string(),
  }).strict(),
  z.object({ type: z.literal('model.output.started'), providerAttempt: z.number().int().positive() }).strict(),
  z.object({
    type: z.literal('model.retry.scheduled'),
    currentAttempt: z.number().int().positive(),
    nextAttempt: z.number().int().positive(),
    reasonCode: z.string(),
  }).strict(),
  z.object({
    type: z.literal('model.stream.interrupted'),
    providerAttempt: z.number().int().positive(),
    reasonCode: z.string(),
    contentId: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('tool.permission.resolved'),
    toolCallId: z.string(),
    decision: z.enum(['automatic_allow', 'automatic_deny', 'user_allow', 'user_deny']),
    reasonCode: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('discovery.candidate.decided'),
    candidateId: z.string(),
    decision: z.enum(['accepted', 'rejected', 'deduplicated', 'updated']),
    reasonCode: z.string().optional(),
  }).strict(),
  z.object({
    type: z.literal('discovery.retry.scheduled'),
    currentAttempt: z.number().int().positive(),
    nextAttempt: z.number().int().positive(),
    reasonCode: z.string(),
  }).strict(),
  z.object({
    type: z.literal('recommendation.selection.conflict'),
    conflictCount: z.number().int().positive(),
  }).strict(),
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export type TraceLinkTarget =
  | { readonly by: 'trace_id'; readonly traceId: string }
  | {
      readonly by: 'correlation';
      readonly traceKind: TraceKind;
      readonly correlation: TraceCorrelation;
      readonly state: 'active' | 'latest_ended' | 'latest_incomplete';
    };

export const TraceLinkTargetSchema: z.ZodType<TraceLinkTarget> = z.discriminatedUnion('by', [
  z.object({ by: z.literal('trace_id'), traceId: z.string().uuid() }).strict(),
  z.object({
    by: z.literal('correlation'),
    traceKind: TraceKindSchema,
    correlation: TraceCorrelationSchema,
    state: z.enum(['active', 'latest_ended', 'latest_incomplete']),
  }).strict(),
]);
