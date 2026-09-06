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
  processedRevision: z.number().int().nonnegative().optional(),
  policyRevision: z.number().int().nonnegative(),
  lastOutcome: z.enum(['changed', 'unchanged', 'insufficient']).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if ((value.scope === 'interest') !== Boolean(value.interestId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Interest scope requires an Interest identity.' });
  }
  if (value.processedRevision !== undefined && value.processedRevision > value.revision) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Processed revision cannot lead current inputs.' });
  }
});
export const PreferenceSchema = z.object({
  id: z.string().min(1),
  preferenceSetId: z.string().min(1),
  origin: z.enum(['learned', 'user']),
  polarity: PreferencePolaritySchema.optional(),
  dimension: PreferenceDimensionSchema.optional(),
  statement: z.string().trim().refine((value) => [...value].length >= 1 && [...value].length <= 1000),
  revision: z.number().int().positive(),
  status: z.enum(['active', 'needs_review', 'retired', 'deleted']),
  userEditedAt: TimestampSchema.optional(),
  deletedAt: TimestampSchema.optional(),
  deletedFeedbackSequence: z.number().int().nonnegative().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const validOrigin = value.origin === 'learned'
    ? value.polarity !== undefined && value.dimension !== undefined && value.userEditedAt === undefined
    : value.polarity === undefined && value.dimension === undefined && value.userEditedAt !== undefined
      && (value.status === 'active' || value.status === 'deleted');
  const validDeletion = value.status === 'deleted'
    ? value.deletedAt !== undefined && value.deletedFeedbackSequence !== undefined
    : value.deletedAt === undefined && value.deletedFeedbackSequence === undefined;
  if (!validOrigin || !validDeletion) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid preference ownership or deletion state.' });
});
export const PreferenceEvidenceSchema = z.object({
  id: z.string().min(1),
  preferenceId: z.string().min(1),
  recommendationId: z.string().min(1),
  reactionRevision: z.number().int().positive(),
  reaction: FeedbackReactionSchema,
  relation: z.enum(['support', 'counter']),
  explanation: z.string().trim().min(1).max(1000).optional(),
  contentQuote: z.string().min(1).max(2000).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
}).strict();
export const PreferenceDetailSchema = z.object({
  preference: PreferenceSchema,
  evidence: z.array(PreferenceEvidenceSchema),
}).strict();
export const PreferenceSetDetailSchema = z.object({
  preferenceSet: PreferenceSetSchema,
  preferences: z.array(PreferenceDetailSchema),
}).strict();
export const LearnedScopeInputSchema = z.object({
  preferenceSetId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  changes: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('add'), statement: z.string().trim().min(1).max(1000), polarity: PreferencePolaritySchema, dimension: PreferenceDimensionSchema,
      evidence: z.array(z.object({ recommendationId: z.string().min(1), relation: z.enum(['support','counter']), explanation: z.string().trim().min(1).max(1000), contentQuote: z.string().min(1).max(2000).optional() }).strict()).min(1),
      deletedPreferenceId: z.string().min(1).optional(),
    }).strict(),
    z.object({ kind: z.literal('update'), preferenceId: z.string().min(1), expectedRevision: z.number().int().positive(), statement: z.string().trim().min(1).max(1000), polarity: PreferencePolaritySchema, dimension: PreferenceDimensionSchema,
      evidence: z.array(z.object({ recommendationId: z.string().min(1), relation: z.enum(['support','counter']), explanation: z.string().trim().min(1).max(1000), contentQuote: z.string().min(1).max(2000).optional() }).strict()).min(1),
    }).strict(),
    z.object({ kind: z.literal('retire'), preferenceId: z.string().min(1), expectedRevision: z.number().int().positive(), reason: z.string().trim().min(1).max(1000) }).strict(),
  ])),
  reviewedPreferenceIds: z.array(z.string().min(1)),
  outcome: z.enum(['changed','unchanged','insufficient']),
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
export const PreferenceScopeRequestSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('interest'), interestId: z.string().min(1) }).strict(),
  z.object({ scope: z.literal('exploration') }).strict(),
]);
export type PreferenceScopeRequest = z.infer<typeof PreferenceScopeRequestSchema>;
export const PreferenceManagementDetailsSchema = z.object({
  scope: PreferenceScopeRequestSchema,
  hasPendingLearning: z.boolean(),
  preferences: z.array(z.object({
    preference: PreferenceSchema,
    validity: z.enum(['effective', 'needs_review', 'interest_paused']),
  }).strict()),
}).strict();
export type PreferenceManagementDetails = z.infer<typeof PreferenceManagementDetailsSchema>;
export const PreferenceEvidenceViewSchema = z.object({
  preferenceId: z.string().min(1),
  historicalSourceOnly: z.boolean(),
  evidence: z.array(z.object({
    reference: PreferenceEvidenceSchema,
    title: z.string(), sourceName: z.string(), canonicalUrl: z.string().url(),
    currentReaction: FeedbackReactionSchema.optional(),
    currentReactionRevision: z.number().int().nonnegative(),
    current: z.boolean(), content: RecommendationContentEvidenceSchema,
  }).strict()),
}).strict();
export type PreferenceEvidenceView = z.infer<typeof PreferenceEvidenceViewSchema>;
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
  readonly reactionSequence: number;
  readonly reaction: FeedbackReaction;
  readonly matchedInterestIds: readonly string[];
}
/** Exists only for the lifetime of one learning operation; never stored as a business record. */
export interface PreferenceLearningFacts {
  readonly batch: { readonly batchId: string; readonly startedAt: string; readonly changeCount: number };
  readonly currentPreferences: readonly PreferenceSetDetail[];
  readonly reactionChanges: readonly PreferenceLearningReactionChange[];
  readonly supportingReactions: readonly PreferenceLearningSupport[];
  readonly interests: readonly import('../interests/interest').Interest[];
  readonly reviewedPreferenceIds: readonly string[];
  readonly allowAdd?: boolean;
}
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
