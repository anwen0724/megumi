/*
 * Defines Context-owned Discovery source seams plus the bounded Facts and Material
 * contracts for Candidate Supply, Recommendation, and Preference Learning.
 * Discovery implements the read seams; only Context decides model-visible shape.
 */

export type PreferencePolarity = 'positive' | 'negative';
export type PreferenceDimension =
  | 'topic'
  | 'source'
  | 'author'
  | 'content_type'
  | 'recency'
  | 'expression_quality';

export interface ContextPreference {
  readonly id: string;
  readonly origin: 'learned' | 'user';
  readonly status: 'active' | 'needs_review' | 'retired' | 'deleted';
  readonly revision: number;
  readonly userEditedAt?: string;
  readonly deletedFeedbackSequence?: number;
  readonly evidence: readonly {
    readonly recommendationId: string; readonly reactionRevision: number;
    readonly reaction: 'liked' | 'disliked'; readonly relation: 'support' | 'counter';
    readonly explanation?: string; readonly contentQuote?: string;
  }[];
  readonly polarity?: PreferencePolarity;
  readonly dimension?: PreferenceDimension;
  readonly statement: string;
  readonly supportingRecommendationIds: readonly string[];
  readonly updatedAt: string;
}

export interface ContextPreferenceSet {
  readonly preferenceSetId: string;
  readonly scope: 'interest' | 'exploration';
  readonly interestId?: string;
  readonly revision: number;
  readonly preferences: readonly ContextPreference[];
}

export interface DiscoveryInterestFact {
  readonly interestId: string;
  readonly description: string;
  readonly descriptionUserEditedAt?: string;
  readonly status?: 'active' | 'paused' | 'deleted';
  readonly interestRevision: number;
  readonly preference?: ContextPreferenceSet;
}

export interface CandidatePoolFact {
  readonly minimumCount: number;
  readonly targetCount: number;
  readonly maximumCount: number;
  readonly availableCount: number;
  readonly minimumShortfall: number;
  readonly targetShortfall: number;
  readonly availableByInterest: Readonly<Record<string, number>>;
}

export interface CandidateSummaryFact {
  readonly candidateId: string;
  readonly contentIdentity: string;
  readonly sourceId?: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly contentType: string;
  readonly title: string;
  readonly author?: string;
  readonly contentPublishedAt?: string;
  readonly description?: string;
  readonly contentSummary: string;
  readonly contentExcerpt?: string;
  readonly contentTruncated: boolean;
  readonly evidenceCompleteness?: 'full' | 'partial' | 'metadata_only';
}

export interface CandidateSupplyFacts {
  readonly asOf: string;
  readonly executionId: string;
  readonly startedAt: string;
  readonly trigger: string;
  readonly pool: CandidatePoolFact;
  readonly sourceIds: readonly string[];
  readonly interests: readonly {
    readonly interestId: string;
    readonly description: string;
    readonly interestRevision: number;
  }[];
}

export interface ContextDiscoverySourceFact {
  readonly sourceId: string;
  readonly name: string;
  readonly access: string;
  readonly supportedModes: readonly string[];
  readonly supportsRead: boolean;
  readonly availability: string;
  readonly retryAt?: string;
}

export interface CandidateSupplyContextMaterial {
  readonly execution: { readonly startedAt: string; readonly trigger: string };
  readonly pool: CandidatePoolFact;
  readonly interests: CandidateSupplyFacts['interests'];
  readonly sources: readonly ContextDiscoverySourceFact[];
}

export interface RecommendationHistoryFact {
  readonly recommendationId: string;
  readonly contentIdentity: string;
  readonly sourceName: string;
  readonly contentType: string;
  readonly title: string;
  readonly recommendationReason: string;
  readonly publishedAt: string;
  readonly matchedInterestIds: readonly string[];
  readonly reaction?: 'liked' | 'disliked';
}

export interface RecommendationCandidateFact extends Omit<CandidateSummaryFact, 'contentExcerpt'> {
  readonly matchedInterestIds: readonly string[];
  readonly interestMatches: readonly {
    readonly interestId: string;
    readonly relevance: 'direct' | 'adjacent' | 'exploration';
    readonly matchReason: string;
  }[];
}

export interface RecommendationFacts {
  readonly asOf: string;
  readonly execution: {
    readonly requestId: string;
    readonly localDate: string;
    readonly actualTarget: number;
    readonly eligibleCount: number;
    readonly workingSetCount: number;
  };
  readonly interests: readonly DiscoveryInterestFact[];
  readonly preferences: readonly ContextPreferenceSet[];
  readonly candidates: readonly RecommendationCandidateFact[];
  readonly recentRecommendations: readonly RecommendationHistoryFact[];
  readonly ranking: readonly {
    readonly candidateId: string;
    readonly eligible: boolean;
    readonly exclusionReason?: string;
    readonly rank?: number;
    readonly relevanceRank?: number;
    readonly rankingFacts?: {
      readonly currentInterestCount: number;
      readonly historicalInterestCount: number;
      readonly currentSourceCount: number;
      readonly historicalSourceCount: number;
      readonly currentContentTypeCount: number;
      readonly historicalContentTypeCount: number;
    };
  }[];
}

export interface RecommendationContextMaterial {
  readonly execution: RecommendationFacts['execution'];
  readonly interests: readonly DiscoveryInterestFact[];
  readonly preferences: readonly ContextPreferenceSet[];
  readonly candidates: readonly RecommendationCandidateFact[];
  readonly recentRecommendations: readonly RecommendationHistoryFact[];
}

export interface PreferenceLearningReactionFact {
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
    readonly contentEvidence: {
      readonly sourceId: string;
      readonly canonicalUrl: string;
      readonly title: string;
      readonly description?: string;
      readonly contentText?: string;
      readonly contentSummary: string;
      readonly completeness: 'full' | 'partial' | 'metadata_only';
    };
  };
  readonly previouslySupportedPreferenceIds: readonly string[];
}

export interface PreferenceLearningFacts {
  readonly asOf: string;
  readonly batch: {
    readonly batchId: string;
    readonly startedAt: string;
    readonly changeCount: number;
  };
  readonly interests: readonly {
    readonly interestId: string;
    readonly description: string;
    readonly status: 'active' | 'paused' | 'deleted';
    readonly revision: number;
    readonly descriptionUserEditedAt?: string;
  }[];
  readonly currentPreferences: readonly ContextPreferenceSet[];
  readonly reactionChanges: readonly PreferenceLearningReactionFact[];
  readonly supportingReactions: readonly {
    readonly recommendationId: string;
    readonly reactionRevision: number;
    readonly reactionSequence: number;
    readonly reaction: 'liked' | 'disliked';
    readonly matchedInterestIds: readonly string[];
  }[];
  readonly reviewedPreferenceIds: readonly string[];
  readonly allowAdd?: boolean;
}

export interface PreferenceLearningContextMaterial {
  readonly batch: PreferenceLearningFacts['batch'];
  readonly interests: PreferenceLearningFacts['interests'];
  readonly currentPreferences: readonly ContextPreferenceSet[];
  readonly reactionChanges: readonly PreferenceLearningReactionFact[];
  readonly supportingReactions: PreferenceLearningFacts['supportingReactions'];
  readonly reviewedPreferenceIds: readonly string[];
  readonly allowAdd?: boolean;
}

export type ReadDiscoveryFactsResult<T> =
  | { readonly status: 'ok'; readonly facts: T }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string } }
  | { readonly status: 'cancelled' };

/** Read-only Owner adapter consumed exclusively by Discovery Context resolvers. */
export interface DiscoveryFactsReader {
  readCandidateSupplyFacts(request: {
    readonly executionId: string;
    readonly signal?: AbortSignal;
  }): Promise<ReadDiscoveryFactsResult<CandidateSupplyFacts>>;
  readRecommendationFacts(request: {
    readonly executionId: string;
    readonly requestId: string;
    readonly localDate: string;
    readonly signal?: AbortSignal;
  }): Promise<ReadDiscoveryFactsResult<RecommendationFacts>>;
  readPreferenceLearningFacts(request: {
    readonly batchId: string;
    readonly signal?: AbortSignal;
  }): Promise<ReadDiscoveryFactsResult<PreferenceLearningFacts>>;
}

/** Runtime Source capability view; credentials and Source adapters never cross this seam. */
export interface ContextDiscoverySourceRegistry {
  listContextSources(request: {
    readonly executionId: string;
    readonly at: string;
  }): readonly ContextDiscoverySourceFact[];
}
