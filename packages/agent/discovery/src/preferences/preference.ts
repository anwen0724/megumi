/*
 * Defines durable Preference entities, composed read results, and ephemeral learning contracts.
 */
import { z } from 'zod';

const TimestampSchema = z.string().datetime({ offset: true });
export const FeedbackReactionSchema = z.enum(['liked', 'disliked']);
export const PreferenceScopeSchema = z.enum(['interest', 'exploration']);
export const PreferencePolaritySchema = z.enum(['positive', 'negative']);
export const PreferenceDimensionSchema = z.enum([
  'topic', 'source', 'author', 'content_type', 'recency', 'expression_quality',
]);
export const PreferenceSetSchema = z.object({
  id: z.string().min(1),
  scope: PreferenceScopeSchema,
  interestId: z.string().min(1).optional(),
  revision: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.scope === 'interest') !== Boolean(value.interestId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Interest scope requires an Interest identity.' });
  }
});
export const PreferenceSchema = z.object({
  id: z.string().min(1),
  preferenceSetId: z.string().min(1),
  polarity: PreferencePolaritySchema,
  dimension: PreferenceDimensionSchema,
  statement: z.string().trim().min(1).max(1000),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export const PreferenceEvidenceSchema = z.object({
  id: z.string().min(1),
  preferenceId: z.string().min(1),
  recommendationId: z.string().min(1),
  reactionRevision: z.number().int().positive(),
  reaction: FeedbackReactionSchema,
  createdAt: TimestampSchema,
}).strict();
export const PreferenceDetailSchema = z.object({
  preference: PreferenceSchema,
  evidence: z.array(PreferenceEvidenceSchema),
}).strict();
export const PreferenceSetDetailSchema = z.object({
  preferenceSet: PreferenceSetSchema,
  preferences: z.array(PreferenceDetailSchema),
}).strict();
export const LearnedPreferenceInputSchema = z.object({
  id: z.string().min(1),
  polarity: PreferencePolaritySchema,
  dimension: PreferenceDimensionSchema,
  statement: z.string().trim().min(1).max(1000),
  supportingRecommendationIds: z.array(z.string().min(1)).min(1),
}).strict();
export const LearnedScopeInputSchema = z.object({
  preferenceSetId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  preferences: z.array(LearnedPreferenceInputSchema),
}).strict();
export const RecommendationContentEvidenceSchema = z.object({
  sourceId: z.string().min(1), canonicalUrl: z.string().url(),
  title: z.string().trim().min(1),
  contentSummary: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  contentText: z.string().trim().min(1).optional(),
  completeness: z.enum(['full', 'partial', 'metadata_only']),
}).strict();

export type PreferenceSet = z.infer<typeof PreferenceSetSchema>;
export type Preference = z.infer<typeof PreferenceSchema>;
export type PreferenceEvidence = z.infer<typeof PreferenceEvidenceSchema>;
export type PreferenceDetail = z.infer<typeof PreferenceDetailSchema>;
export type PreferenceSetDetail = z.infer<typeof PreferenceSetDetailSchema>;
export type LearnedScopeInput = z.infer<typeof LearnedScopeInputSchema>;
export type FeedbackReaction = z.infer<typeof FeedbackReactionSchema>;
export type RecommendationContentEvidence = z.infer<typeof RecommendationContentEvidenceSchema>;

export interface PreferenceLearningReactionChange {
  readonly recommendationId: string;
  readonly learnedReaction?: FeedbackReaction;
  readonly learnedReactionRevision: number;
  readonly currentReaction?: FeedbackReaction;
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
  readonly previouslySupportedPreferenceIds: readonly string[];
}
/** Captures allowed, currently effective feedback versions, including unchanged historical support. */
export interface PreferenceLearningSupport {
  readonly recommendationId: string;
  readonly reactionRevision: number;
  readonly reaction: FeedbackReaction;
  readonly matchedInterestIds: readonly string[];
}
/** Exists only for the lifetime of one learning operation; never stored as a business record. */
export interface PreferenceLearningFacts {
  readonly batch: { readonly batchId: string; readonly startedAt: string; readonly changeCount: number };
  readonly currentPreferences: readonly PreferenceSetDetail[];
  readonly reactionChanges: readonly PreferenceLearningReactionChange[];
  readonly supportingReactions: readonly PreferenceLearningSupport[];
}
export type PreferenceLearningTrigger =
  | { readonly status: 'idle' }
  | { readonly status: 'scheduled'; readonly pendingReactionCount: number; readonly dueAt: string }
  | { readonly status: 'ready'; readonly reason: 'threshold' | 'deadline' | 'correction'; readonly pendingReactionCount: number };
export type CommitPreferenceLearningResult =
  | { readonly status: 'committed'; readonly revisions: readonly { readonly preferenceSetId: string; readonly revision: number }[]; readonly affectedInterestIds: readonly string[] }
  | { readonly status: 'rejected'; readonly reason: 'scope_mismatch' | 'revision_conflict' | 'invalid_interest_reference' | 'invalid_preference_reference' | 'invalid_recommendation_reference' };

export const PreferenceLearningCompletionSchema = z.object({
  recommendationId: z.string().min(1),
  status: z.enum(['pending', 'learned']),
  currentReactionRevision: z.number().int().nonnegative(),
  learnedReactionRevision: z.number().int().nonnegative(),
  changedAt: TimestampSchema,
  preferences: z.array(PreferenceSetDetailSchema),
}).strict();
export type PreferenceLearningCompletion = z.infer<typeof PreferenceLearningCompletionSchema>;
