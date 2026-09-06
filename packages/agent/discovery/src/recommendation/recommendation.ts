/* Defines Recommendation persistence, read-model, execution, and ranking contracts. */
import { z } from 'zod';
import { CandidateSchema, type Candidate, type CandidateInterestMatch } from '../candidate-supply/candidate-supply';

const TimestampSchema = z.string().datetime({ offset: true });
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ReactionSchema = z.enum(['liked', 'disliked']);

export const RecommendationSelectionBasisSchema = z.object({
  primaryInterestId: z.string().min(1),
  matchedInterestIds: z.array(z.string().min(1)).min(1),
  interestRevisions: z.array(z.object({
    interestId: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict()),
  preferenceRevisions: z.array(z.object({
    preferenceSetId: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }).strict()),
}).strict();

export const RecommendationDecisionSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  contentIdentity: z.string().min(1),
  localDate: LocalDateSchema,
  position: z.number().int().nonnegative(),
  recommendationReason: z.string().trim().min(1).max(1000),
  selectionBasis: RecommendationSelectionBasisSchema,
  publishedAt: TimestampSchema,
}).strict();

export const RecommendationContentSchema = CandidateSchema.pick({
  sourceId: true,
  sourceContentId: true,
  canonicalUrl: true,
  contentType: true,
  title: true,
  author: true,
  description: true,
  contentSummary: true,
  contentExcerpt: true,
  contentTruncated: true,
  coverUrl: true,
}).extend({
  id: z.string().min(1),
  recommendationId: z.string().min(1),
  sourceName: z.string().trim().min(1),
  contentPublishedAt: TimestampSchema.optional(),
}).strict();

export const RecommendationStateSchema = z.object({
  id: z.string().min(1),
  recommendationId: z.string().min(1),
  reaction: ReactionSchema.optional(),
  reactionRevision: z.number().int().nonnegative(),
  reactionSequence: z.number().int().nonnegative(),
  reactionChangedAt: TimestampSchema.optional(),
  learnedReaction: ReactionSchema.optional(),
  learnedReactionRevision: z.number().int().nonnegative(),
  favoriteAt: TimestampSchema.optional(),
  watchLaterAt: TimestampSchema.optional(),
  hiddenAt: TimestampSchema.optional(),
  firstOpenedAt: TimestampSchema.optional(),
  lastOpenedAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.learnedReactionRevision > value.reactionRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Learned Reaction cannot lead current Reaction.' });
  }
  if (value.learnedReactionRevision === value.reactionRevision
    && value.learnedReaction !== value.reaction) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A fully learned Reaction must match current Reaction.' });
  }
  if ((value.firstOpenedAt === undefined) !== (value.lastOpenedAt === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Opened timestamps must be present together.' });
  }
});

export const RecommendationSchema = RecommendationDecisionSchema.extend({
  content: RecommendationContentSchema,
  state: RecommendationStateSchema,
}).strict();

export const RecommendationCollectionSchema = z.object({
  localDate: LocalDateSchema,
  publishedAt: TimestampSchema,
  items: z.array(RecommendationSchema),
}).strict();

export const UpdateRecommendationStateRequestSchema = z.discriminatedUnion('action', [
  z.object({ recommendationId: z.string().min(1), action: z.literal('opened') }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_reaction'),
    reaction: ReactionSchema.nullable(),
  }).strict(),
  z.object({ recommendationId: z.string().min(1), action: z.literal('set_hidden'), hidden: z.boolean() }).strict(),
  z.object({ recommendationId: z.string().min(1), action: z.literal('set_favorite'), favorite: z.boolean() }).strict(),
  z.object({
    recommendationId: z.string().min(1),
    action: z.literal('set_watch_later'),
    watchLater: z.boolean(),
  }).strict(),
]);

export type RecommendationSelectionBasis = z.infer<typeof RecommendationSelectionBasisSchema>;
export type RecommendationDecision = z.infer<typeof RecommendationDecisionSchema>;
export type RecommendationContent = z.infer<typeof RecommendationContentSchema>;
export type RecommendationState = z.infer<typeof RecommendationStateSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type RecommendationCollection = z.infer<typeof RecommendationCollectionSchema>;
export type UpdateRecommendationStateRequest = z.infer<typeof UpdateRecommendationStateRequestSchema>;

export interface RecommendationCandidate {
  readonly candidate: Candidate;
  readonly sourceName: string;
  readonly interestMatches: readonly CandidateInterestMatch[];
}

export interface RecommendationHistoryItem {
  readonly recommendationId: string;
  readonly candidateId: string;
  readonly contentIdentity: string;
  readonly sourceId: string;
  readonly contentType: string;
  readonly matchedInterestIds: readonly string[];
  readonly publishedAt: string;
}

export type RecommendationExclusionReason =
  | 'not_available'
  | 'expired'
  | 'no_active_interest_match'
  | 'already_recommended'
  | 'source_unavailable';

export interface RankedRecommendationCandidate extends RecommendationCandidate {
  readonly rank: number;
  readonly primaryInterestId: string;
  readonly relevanceRank: number;
  readonly rankingFacts: {
    readonly currentInterestCount: number;
    readonly historicalInterestCount: number;
    readonly currentSourceCount: number;
    readonly historicalSourceCount: number;
    readonly currentContentTypeCount: number;
    readonly historicalContentTypeCount: number;
  };
}

export interface RecommendationRankingResult {
  readonly eligibleCount: number;
  readonly actualTargetCount: number;
  readonly rankedCandidates: readonly RankedRecommendationCandidate[];
  readonly initialWorkingSet: readonly RankedRecommendationCandidate[];
  readonly exclusions: readonly {
    readonly candidateId: string;
    readonly reason: RecommendationExclusionReason;
  }[];
}
