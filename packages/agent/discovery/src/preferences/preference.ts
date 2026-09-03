/*
 * Defines durable Recommendation Reaction, Preference Learning Batch, and
 * stable Preference revision contracts for the Discovery owner.
 */
import { z } from 'zod';

const TimestampSchema = z.string().datetime({ offset: true });
export const FeedbackReactionSchema = z.enum(['liked', 'disliked']);
export const PreferenceScopeSchema = z.enum(['interest', 'exploration']);
export const PreferencePolaritySchema = z.enum(['positive', 'negative']);
export const PreferenceDimensionSchema = z.enum([
  'topic',
  'source',
  'author',
  'content_type',
  'recency',
  'expression_quality',
]);

export const RecommendationContentEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  contentText: z.string().trim().min(1).optional(),
  completeness: z.enum(['full', 'partial', 'metadata_only']),
}).strict();

export const PreferenceDirectionSchema = z.object({
  directionId: z.string().min(1),
  polarity: PreferencePolaritySchema,
  dimension: PreferenceDimensionSchema,
  statement: z.string().trim().min(1).max(1000),
  supportingRecommendationIds: z.array(z.string().min(1)).min(1),
  updatedAt: TimestampSchema,
}).strict();

export const PreferenceSnapshotSchema = z.object({
  scopeKey: z.string().min(1),
  scope: PreferenceScopeSchema,
  interestId: z.string().min(1).optional(),
  revision: z.number().int().nonnegative(),
  directions: z.array(PreferenceDirectionSchema),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.scope === 'interest') !== Boolean(value.interestId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Interest Preference scopes require exactly one Interest identity.',
    });
  }
});

export const PreferenceLearningBatchSchema = z.discriminatedUnion('status', [
  z.object({
    batchId: z.string().min(1),
    status: z.literal('running'),
    triggerReason: z.enum(['threshold', 'deadline', 'correction', 'retry']),
    changeCount: z.number().int().min(1).max(20),
    retryCount: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema,
  }).strict(),
  z.object({
    batchId: z.string().min(1),
    status: z.literal('succeeded'),
    triggerReason: z.enum(['threshold', 'deadline', 'correction', 'retry']),
    changeCount: z.number().int().min(1).max(20),
    retryCount: z.number().int().nonnegative(),
    createdAt: TimestampSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    resultRevisions: z.array(z.object({
      scopeKey: z.string().min(1),
      revision: z.number().int().nonnegative(),
    }).strict()),
  }).strict(),
  z.object({
    batchId: z.string().min(1),
    status: z.literal('failed'),
    triggerReason: z.enum(['threshold', 'deadline', 'correction', 'retry']),
    changeCount: z.number().int().min(1).max(20),
    retryCount: z.number().int().nonnegative(),
    retryAt: TimestampSchema,
    createdAt: TimestampSchema,
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    failureCode: z.string().min(1),
    failureMessage: z.string(),
  }).strict(),
]);

export const LearnedDirectionInputSchema = PreferenceDirectionSchema.omit({ updatedAt: true });
export const LearnedScopeInputSchema = z.object({
  scopeKey: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  directions: z.array(LearnedDirectionInputSchema),
}).strict();

export interface PreferenceLearningAffectedScope {
  readonly scopeKey: string;
  readonly scope: 'interest' | 'exploration';
  readonly interestId?: string;
  readonly baseRevision: number;
}

export interface PreferenceLearningReactionChange {
  readonly recommendationId: string;
  readonly learnedReaction?: 'liked' | 'disliked';
  readonly learnedReactionRevision: number;
  readonly currentReaction?: 'liked' | 'disliked';
  readonly currentReactionRevision: number;
  readonly changedAt: string;
  readonly requiresCorrection: boolean;
  readonly recommendation: {
    readonly title: string;
    readonly sourceName: string;
    readonly author?: string;
    readonly contentType: string;
    readonly publishedAt: string;
    readonly recommendationReason: string;
    readonly matchedInterestIds: readonly string[];
    readonly contentEvidence: RecommendationContentEvidence;
  };
  readonly previouslySupportedDirectionIds: readonly string[];
}

export interface PreferenceLearningFacts {
  readonly batch: PreferenceLearningBatch;
  readonly affectedScopes: readonly PreferenceLearningAffectedScope[];
  readonly currentPreferences: readonly PreferenceSnapshot[];
  readonly reactionChanges: readonly PreferenceLearningReactionChange[];
}

export type PreferenceLearningTrigger =
  | { readonly status: 'idle' }
  | { readonly status: 'scheduled'; readonly pendingReactionCount: number; readonly dueAt: string }
  | {
      readonly status: 'ready';
      readonly reason: 'threshold' | 'deadline' | 'correction' | 'retry';
      readonly pendingReactionCount: number;
    };

export type CommitPreferenceLearningBatchResult =
  | {
      readonly status: 'committed';
      readonly revisions: readonly { readonly scopeKey: string; readonly revision: number }[];
      readonly affectedInterestIds: readonly string[];
    }
  | {
      readonly status: 'rejected';
      readonly reason:
        | 'batch_not_running'
        | 'scope_mismatch'
        | 'revision_conflict'
        | 'invalid_interest_reference'
        | 'invalid_direction_reference'
        | 'invalid_recommendation_reference';
    };

export const PreferenceLearningCompletionSchema = z.object({
  recommendationId: z.string().min(1),
  status: z.enum(['pending', 'batched', 'learned', 'failed']),
  batchId: z.string().min(1).optional(),
  resultRevisions: z.array(z.object({
    scopeKey: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict()),
  failure: z.object({ code: z.string().min(1), message: z.string() }).strict().optional(),
  changedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
}).strict();

export type FeedbackReaction = z.infer<typeof FeedbackReactionSchema>;
export type PreferenceSnapshot = z.infer<typeof PreferenceSnapshotSchema>;
export type PreferenceDirection = z.infer<typeof PreferenceDirectionSchema>;
export type PreferenceLearningBatch = z.infer<typeof PreferenceLearningBatchSchema>;
export type LearnedScopeInput = z.infer<typeof LearnedScopeInputSchema>;
export type RecommendationContentEvidence = z.infer<typeof RecommendationContentEvidenceSchema>;
export type PreferenceLearningCompletion = z.infer<typeof PreferenceLearningCompletionSchema>;
