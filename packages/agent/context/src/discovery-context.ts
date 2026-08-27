/*
 * Defines Context-owned Discovery source seams plus the bounded Facts and Material
 * contracts for Candidate Supply, Daily Recommendation, and Preference Learning.
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

export interface ContextPreferenceDirection {
  readonly directionId: string;
  readonly polarity: PreferencePolarity;
  readonly dimension: PreferenceDimension;
  readonly statement: string;
  readonly supportingFeedbackIds: readonly string[];
  readonly updatedAt: string;
}

export interface ContextPreferenceSnapshot {
  readonly scopeKey: string;
  readonly scope: 'interest' | 'exploration';
  readonly interestId?: string;
  readonly revision: number;
  readonly directions: readonly ContextPreferenceDirection[];
}

export interface DiscoveryInterestFact {
  readonly interestId: string;
  readonly description: string;
  readonly status?: 'active' | 'paused' | 'deleted';
  readonly interestRevision: number;
  readonly preference: ContextPreferenceSnapshot;
}

export interface CandidatePoolFact {
  readonly counts: Readonly<Record<string, number>>;
  readonly lowWatermark: number;
  readonly target: number;
  readonly hardLimit: number;
  readonly totalShortfall: number;
  readonly uncoveredInterestIds: readonly string[];
  readonly consumerShortfalls: readonly {
    readonly consumer: 'daily' | 'proactive';
    readonly count: number;
  }[];
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
  readonly evidenceCompleteness?: 'full' | 'partial' | 'metadata_only';
}

export interface CandidateDuplicateFact {
  readonly kind: 'candidate' | 'recommendation';
  readonly identity: string;
  readonly title: string;
  readonly similarity: 'identity' | 'url' | 'source_content' | 'semantic';
}

export interface PendingAdmissionCandidateFact {
  readonly candidate: CandidateSummaryFact;
  readonly potentialDuplicates: readonly CandidateDuplicateFact[];
}

export interface DiscoveryQueryOutcomeFact {
  readonly queryId: string;
  readonly query: string;
  readonly sourceId: string;
  readonly mode: string;
  readonly targetInterestIds: readonly string[];
  readonly status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly normalizedResultCount: number;
  readonly newCandidateCount: number;
  readonly mergedCandidateCount: number;
  readonly alreadyRecommendedCount: number;
  readonly capacityRejectedCount: number;
  readonly failureCode?: string;
  readonly completedAt?: string;
}

export interface CandidateSupplyFacts {
  readonly asOf: string;
  readonly executionId: string;
  readonly startedAt: string;
  readonly trigger: string;
  readonly pool: CandidatePoolFact;
  readonly interests: readonly DiscoveryInterestFact[];
  readonly explorationPreference: ContextPreferenceSnapshot;
  readonly negativeConstraints: readonly string[];
  readonly recentQueryOutcomes: readonly DiscoveryQueryOutcomeFact[];
  readonly pendingCandidates: readonly PendingAdmissionCandidateFact[];
  readonly budget: {
    readonly searchesRemaining: number;
    readonly readsRemaining: number;
    readonly rawResultsRemaining: number;
  };
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
  readonly interests: readonly DiscoveryInterestFact[];
  readonly explorationPreference: ContextPreferenceSnapshot;
  readonly negativeConstraints: readonly string[];
  readonly sources: readonly ContextDiscoverySourceFact[];
  readonly recentQueryOutcomes: readonly DiscoveryQueryOutcomeFact[];
  readonly pendingAdmissionBatch: {
    readonly items: readonly PendingAdmissionCandidateFact[];
    readonly totalCount: number;
    readonly truncated: boolean;
  };
  readonly remainingBudget: CandidateSupplyFacts['budget'];
}

export interface DailyRecommendationHistoryFact {
  readonly contentIdentity: string;
  readonly sourceName: string;
  readonly title: string;
  readonly recommendationReason: string;
  readonly publishedAt: string;
  readonly matchedInterestIds?: readonly string[];
}

export interface DailyRecommendationCandidateFact extends CandidateSummaryFact {
  readonly assessmentId: string;
  readonly assessmentVersion: string;
  readonly relevance: 'direct' | 'adjacent' | 'exploration';
  readonly matchedInterestIds: readonly string[];
  readonly admissionReason: string;
  readonly interestRevisions: readonly {
    readonly interestId: string;
    readonly revision: number;
  }[];
  readonly preferenceRevisions: readonly {
    readonly scopeKey: string;
    readonly revision: number;
  }[];
  readonly preferenceAlignment?: readonly {
    readonly directionId: string;
    readonly relation: 'aligned' | 'conflicted' | 'neutral';
    readonly reason: string;
  }[];
}

export interface PendingRecommendationFeedbackFact {
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

export interface DailyRecommendationFacts {
  readonly asOf: string;
  readonly batch: {
    readonly batchId: string;
    readonly localDate: string;
    readonly requestedCount: number;
    readonly actualTarget: number;
    readonly availableCount: number;
    readonly readBudget: number;
  };
  readonly interests: readonly DiscoveryInterestFact[];
  readonly explorationPreference: ContextPreferenceSnapshot;
  readonly candidates: readonly DailyRecommendationCandidateFact[];
  readonly recentRecommendations: readonly DailyRecommendationHistoryFact[];
  readonly pendingFeedback: readonly PendingRecommendationFeedbackFact[];
  readonly omittedPendingFeedbackCount: number;
}

export interface DailyRecommendationContextMaterial {
  readonly batch: DailyRecommendationFacts['batch'];
  readonly interests: readonly DiscoveryInterestFact[];
  readonly explorationPreference: ContextPreferenceSnapshot;
  readonly candidates: readonly DailyRecommendationCandidateFact[];
  readonly recentRecommendations: readonly DailyRecommendationHistoryFact[];
  readonly pendingFeedback: readonly PendingRecommendationFeedbackFact[];
  readonly omittedPendingFeedbackCount: number;
}

export interface PreferenceLearningFeedbackFact {
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
    readonly contentEvidence: {
      readonly sourceId: string;
      readonly canonicalUrl: string;
      readonly title: string;
      readonly description?: string;
      readonly contentText?: string;
      readonly completeness: 'full' | 'partial' | 'metadata_only';
    };
  };
  readonly previouslySupportedDirectionIds: readonly string[];
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
  }[];
  readonly currentPreferences: readonly ContextPreferenceSnapshot[];
  readonly feedbackChanges: readonly PreferenceLearningFeedbackFact[];
}

export interface PreferenceLearningContextMaterial {
  readonly batch: PreferenceLearningFacts['batch'];
  readonly interests: PreferenceLearningFacts['interests'];
  readonly currentPreferences: readonly ContextPreferenceSnapshot[];
  readonly feedbackChanges: readonly PreferenceLearningFeedbackFact[];
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
  readDailyRecommendationFacts(request: {
    readonly executionId: string;
    readonly batchId: string;
    readonly localDate: string;
    readonly signal?: AbortSignal;
  }): Promise<ReadDiscoveryFactsResult<DailyRecommendationFacts>>;
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
