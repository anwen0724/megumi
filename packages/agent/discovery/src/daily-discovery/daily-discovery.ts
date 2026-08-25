/* Defines daily batch state, triggers, and public execution results. */
import { z } from 'zod';

const TimestampSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const DailyDiscoveryBatchStatusSchema = z.enum(['running', 'published', 'failed']);

const DailyDiscoveryBatchBaseShape = {
  batchId: z.string().min(1),
  localDate: LocalDateSchema,
  timezone: z.string().trim().min(1),
  executionId: z.string().min(1),
  targetCount: z.number().int().min(1).max(100),
  attemptCount: z.number().int().min(1),
  automaticRetryCount: z.number().int().min(0).max(2),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  startedAt: TimestampSchema,
};

export const DailyDiscoveryBatchSchema = z.discriminatedUnion('status', [
  z.object({
    ...DailyDiscoveryBatchBaseShape,
    status: z.literal('running'),
    resultCount: z.literal(0),
  }).strict(),
  z.object({
    ...DailyDiscoveryBatchBaseShape,
    status: z.literal('published'),
    resultCount: z.number().int().nonnegative(),
    publishedAt: TimestampSchema,
  }).strict(),
  z.object({
    ...DailyDiscoveryBatchBaseShape,
    status: z.literal('failed'),
    resultCount: z.literal(0),
    failureCode: z.string().min(1),
    failureMessage: z.string(),
  }).strict(),
]);

export const DiscoveryFailureViewSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
}).strict();

export const EnsureDailyDiscoveryRequestSchema = z.object({
  trigger: z.enum(['schedule', 'startup_catchup', 'manual', 'retry']),
  now: TimestampSchema,
}).strict();

export type DailyDiscoveryBatch = z.infer<typeof DailyDiscoveryBatchSchema>;
export type DiscoveryFailureView = z.infer<typeof DiscoveryFailureViewSchema>;
export type EnsureDailyDiscoveryRequest = z.infer<typeof EnsureDailyDiscoveryRequestSchema>;

export type EnsureDailyDiscoveryResult =
  | { readonly status: 'started'; readonly localDate: string; readonly batchId: string; readonly executionId: string }
  | { readonly status: 'in_progress'; readonly localDate: string; readonly batchId: string; readonly executionId: string }
  | { readonly status: 'already_published'; readonly localDate: string; readonly batchId: string; readonly resultCount: number; readonly publishedAt: string }
  | { readonly status: 'no_active_interests'; readonly localDate: string }
  | { readonly status: 'no_available_sources'; readonly localDate: string }
  | { readonly status: 'model_unavailable'; readonly localDate: string }
  | { readonly status: 'failed'; readonly localDate: string; readonly failure: DiscoveryFailureView };
