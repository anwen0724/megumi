/*
 * Defines durable Recommendation Feedback, Preference Learning Batch, and
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

export const PreferenceDirectionSchema = z.object({
  directionId: z.string().min(1),
  polarity: PreferencePolaritySchema,
  dimension: PreferenceDimensionSchema,
  statement: z.string().trim().min(1).max(1000),
  supportingFeedbackIds: z.array(z.string().min(1)).min(1),
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

export interface PreferenceLearningFeedbackChange {
  readonly feedbackChangeId: string;
  readonly feedbackId: string;
  readonly recommendationId: string;
  readonly previousReaction?: 'liked' | 'disliked';
  readonly currentReaction?: 'liked' | 'disliked';
  readonly feedbackRevision: number;
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
    readonly contentEvidence: Readonly<Record<string, unknown>>;
  };
  readonly previouslySupportedDirectionIds: readonly string[];
}

export interface PreferenceLearningFacts {
  readonly batch: PreferenceLearningBatch;
  readonly affectedScopes: readonly PreferenceLearningAffectedScope[];
  readonly currentPreferences: readonly PreferenceSnapshot[];
  readonly feedbackChanges: readonly PreferenceLearningFeedbackChange[];
}

export type PreferenceLearningTrigger =
  | { readonly status: 'idle' }
  | { readonly status: 'scheduled'; readonly pendingFeedbackCount: number; readonly dueAt: string }
  | {
      readonly status: 'ready';
      readonly reason: 'threshold' | 'deadline' | 'correction' | 'retry';
      readonly pendingFeedbackCount: number;
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
        | 'invalid_feedback_reference';
    };

export type FeedbackReaction = z.infer<typeof FeedbackReactionSchema>;
export type PreferenceSnapshot = z.infer<typeof PreferenceSnapshotSchema>;
export type PreferenceDirection = z.infer<typeof PreferenceDirectionSchema>;
export type PreferenceLearningBatch = z.infer<typeof PreferenceLearningBatchSchema>;
export type LearnedScopeInput = z.infer<typeof LearnedScopeInputSchema>;
