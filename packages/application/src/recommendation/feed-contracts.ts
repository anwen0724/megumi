/*
 * Defines renderer-safe content cards, daily results and persisted run views.
 */
import { z } from 'zod';
import { RecommendationIssueSchema } from './discovery/discovery-records';
import { PublicationEvidenceSchema } from './content/material-contracts';
export const InterestLabelSchema = z
  .object({
    interestId: z.string(),
    revision: z.number().int().positive(),
    text: z.string(),
    historical: z.boolean(),
  })
  .strict();
export const ContentCardSchema = z
  .object({
    contentId: z.string(),
    materialId: z.string(),
    platform: z.string(),
    title: z.string(),
    url: z.string().url(),
    author: z.string().optional(),
    publishedAt: z.string().optional(),
    publicationPrecision: z.enum(['instant', 'date', 'unknown']),
    excerpt: z.string(),
    materialKind: z.enum(['full_text', 'excerpt', 'description', 'transcript']),
    truncated: z.boolean(),
    interestLabels: z.array(InterestLabelSchema),
    saved: z.boolean(),
  })
  .strict();

export type ContentCard = z.infer<typeof ContentCardSchema>;

export const DailyFeedViewSchema = z
  .object({
    date: z.string(),
    items: z.array(ContentCardSchema),
    batches: z.array(
      z
        .object({
          id: z.string(),
          interestId: z.string(),
          interestRevision: z.number().int().positive(),
          interestText: z.string(),
          status: z.enum(['ready', 'partial', 'empty', 'failed']),
          committedAt: z.string().datetime(),
          windowStart: z.string().datetime(),
          windowEnd: z.string().datetime(),
          issues: z.array(RecommendationIssueSchema),
        })
        .strict(),
    ),
    activeRuns: z.array(z.string()),
  })
  .strict();

export type DailyFeedView = z.infer<typeof DailyFeedViewSchema>;

export const DailyFeedRequestSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();
export const StartDailyFeedRequestSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    interestIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export const StartDailyFeedResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.enum(['started', 'joined']),
      runId: z.string(),
    })
    .strict(),
  z
    .object({
      status: z.literal('already_completed'),
      batchIds: z.array(z.string()),
    })
    .strict(),
]);

export type StartDailyFeedResult = z.infer<typeof StartDailyFeedResultSchema>;

export const RunRequestSchema = z.object({ runId: z.string().min(1) }).strict();
export const RecommendationRunViewSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['daily_feed', 'curated', 'candidate_supply']),
    status: z.enum([
      'queued',
      'running',
      'completed',
      'partial',
      'empty',
      'failed',
      'cancelled',
      'interrupted',
      'superseded',
    ]),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    committedResultId: z.string().optional(),
    issues: z.array(RecommendationIssueSchema),
  })
  .strict();

export type RecommendationRunView = z.infer<typeof RecommendationRunViewSchema>;

export const RecommendationChangedSchema = z
  .object({
    kind: z.enum([
      'interest',
      'daily_feed',
      'curated_selection',
      'favorite',
      'source_access',
      'run',
    ]),
    runId: z.string().optional(),
    resultId: z.string().optional(),
    interestId: z.string().optional(),
  })
  .strict();

export type RecommendationChanged = z.infer<typeof RecommendationChangedSchema>;

export const CancelRunResultSchema = z
  .object({ status: z.enum(['cancelling', 'already_finished', 'not_found']) })
  .strict();
export const PublicationSnapshotSchema = z.array(PublicationEvidenceSchema);
