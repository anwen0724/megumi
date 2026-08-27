/*
 * Defines Daily Recommendation's durable Batch, Candidate-window, and publication contracts.
 */
import { z } from 'zod';
import { CandidateSchema } from '../candidate-supply/candidate-supply';
import type { Recommendation } from '../recommendations/recommendation';

const TimestampSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const DailyRecommendationBatchStatusSchema = z.enum(['running', 'published', 'failed']);

export const DailyRecommendationFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
}).strict();

export const EnsureDailyRecommendationRequestSchema = z.object({
  trigger: z.enum(['schedule', 'startup_catchup', 'manual', 'retry', 'candidate_available']),
  now: TimestampSchema,
}).strict();

export const DailyRecommendationCandidateSchema = CandidateSchema.extend({
  admission: z.object({
    assessmentId: z.string().min(1),
    assessmentVersion: z.string().min(1),
    relevance: z.enum(['direct', 'adjacent', 'exploration']),
    matchedInterestIds: z.array(z.string().min(1)),
    reason: z.string().trim().min(1).max(1000),
    interestRevisions: z.array(z.object({
      interestId: z.string().min(1), revision: z.number().int().nonnegative(),
    }).strict()),
    preferenceRevisions: z.array(z.object({
      scopeKey: z.string().min(1), revision: z.number().int().nonnegative(),
    }).strict()),
    preferenceAlignment: z.array(z.object({
      directionId: z.string().min(1),
      relation: z.enum(['aligned', 'conflicted', 'neutral']),
      reason: z.string().min(1),
    }).strict()),
  }).strict(),
}).strict();

const DailyRecommendationBatchBaseShape = {
  batchId: z.string().min(1),
  localDate: LocalDateSchema,
  timezone: z.string().trim().min(1),
  executionId: z.string().min(1),
  requestedCount: z.number().int().min(1).max(100),
  actualTarget: z.number().int().min(1).max(100),
  attemptCount: z.number().int().min(1),
  automaticRetryCount: z.number().int().min(0).max(2),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  startedAt: TimestampSchema,
};

export const DailyRecommendationBatchSchema = z.discriminatedUnion('status', [
  z.object({
    ...DailyRecommendationBatchBaseShape,
    status: z.literal('running'),
    resultCount: z.literal(0),
  }).strict(),
  z.object({
    ...DailyRecommendationBatchBaseShape,
    status: z.literal('published'),
    resultCount: z.number().int().positive(),
    publishedAt: TimestampSchema,
  }).strict(),
  z.object({
    ...DailyRecommendationBatchBaseShape,
    status: z.literal('failed'),
    resultCount: z.literal(0),
    failureCode: z.string().min(1),
    failureMessage: z.string(),
  }).strict(),
]);

export interface DailyCandidateWindow {
  readonly requestedCount: number;
  readonly actualTarget: number;
  readonly availableCount: number;
  readonly windowLimit: number;
  readonly candidates: readonly DailyRecommendationCandidate[];
}

export interface DailyRecommendationInterest {
  readonly interestId: string;
  readonly description: string;
}

export interface DailyRecommendationPendingFeedback {
  readonly feedbackId: string;
  readonly recommendationId: string;
  readonly reaction: 'liked' | 'disliked';
  readonly changedAt: string;
  readonly learnedFeedbackRevision: number;
  readonly title: string;
  readonly sourceName: string;
  readonly contentType: string;
  readonly description?: string;
  readonly matchedInterestIds: readonly string[];
}

export interface DailyRecommendationSnapshot {
  readonly window: DailyCandidateWindow;
  readonly activeInterests: readonly DailyRecommendationInterest[];
  readonly recentRecommendations: readonly Recommendation[];
  readonly pendingFeedback: readonly DailyRecommendationPendingFeedback[];
  readonly omittedPendingFeedbackCount: number;
}

export type DailyRecommendationCandidate = z.infer<typeof DailyRecommendationCandidateSchema>;
export type DailyRecommendationBatch = z.infer<typeof DailyRecommendationBatchSchema>;
export type DailyRecommendationFailure = z.infer<typeof DailyRecommendationFailureSchema>;
export type EnsureDailyRecommendationRequest = z.infer<typeof EnsureDailyRecommendationRequestSchema>;

export type EnsureDailyRecommendationResult =
  | {
      readonly status: 'started';
      readonly localDate: string;
      readonly batchId: string;
      readonly executionId: string;
      readonly requestedCount: number;
      readonly actualTarget: number;
    }
  | {
      readonly status: 'in_progress';
      readonly localDate: string;
      readonly batchId: string;
      readonly executionId: string;
    }
  | {
      readonly status: 'already_published';
      readonly localDate: string;
      readonly batchId: string;
      readonly resultCount: number;
      readonly publishedAt: string;
    }
  | { readonly status: 'waiting_for_candidates'; readonly localDate: string; readonly requestedCount: number }
  | { readonly status: 'model_unavailable'; readonly localDate: string }
  | { readonly status: 'failed'; readonly localDate: string; readonly failure: DailyRecommendationFailure };
