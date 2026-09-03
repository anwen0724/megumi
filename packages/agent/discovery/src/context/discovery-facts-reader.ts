/*
 * Adapts Discovery-owned repositories and execution attempts to the Context
 * consumer seam. It exposes normalized authoritative facts and never builds a
 * Prompt or chooses model-visible limits.
 */
import type {
  CandidateSupplyFacts,
  ContextDiscoverySourceRegistry,
  ContextPreferenceSnapshot,
  RecommendationFacts,
  DiscoveryFactsReader,
  PreferenceLearningFacts as ContextPreferenceLearningFacts,
} from '@megumi/context';
import type { CandidateSupplyAttempts } from '../candidate-supply/candidate-supply-attempts';
import type { RecommendationAttempts } from '../recommendation/recommendation-attempts';
import type { DiscoveryRepository } from '../persistence/discovery-repository';
import type { SourceRegistry } from '../sources/source-registry';

/** Creates the production read adapter used by all three Discovery Context resolvers. */
export function createDiscoveryFactsReader(options: {
  readonly repository: DiscoveryRepository;
  readonly candidateSupplyAttempts: CandidateSupplyAttempts;
  readonly recommendationAttempts: RecommendationAttempts;
}): DiscoveryFactsReader {
  return {
    async readCandidateSupplyFacts(request) {
      if (request.signal?.aborted) return { status: 'cancelled' };
      const attempt = options.candidateSupplyAttempts.readContextState(request.executionId);
      if (!attempt) return missing('candidate_supply_attempt_not_found');
      const facts: CandidateSupplyFacts = {
        asOf: attempt.snapshot.asOf,
        executionId: request.executionId,
        startedAt: attempt.startedAt,
        trigger: attempt.trigger,
        pool: {
          minimumCount: attempt.snapshot.minimumCount,
          targetCount: attempt.snapshot.targetCount,
          maximumCount: attempt.snapshot.maximumCount,
          availableCount: attempt.snapshot.availableCount,
          minimumShortfall: attempt.snapshot.minimumShortfall,
          targetShortfall: attempt.snapshot.targetShortfall,
          availableByInterest: attempt.snapshot.availableByInterest,
        },
        sourceIds: attempt.enabledSourceIds,
        interests: options.repository.listNonDeletedInterests()
          .filter(({ status }) => status === 'active')
          .map((interest) => ({
            interestId: interest.interestId,
            description: interest.description,
            interestRevision: interest.revision,
          })),
      };
      return { status: 'ok', facts };
    },

    async readRecommendationFacts(request) {
      if (request.signal?.aborted) return { status: 'cancelled' };
      const attempt = options.recommendationAttempts.getSnapshot(request.executionId);
      if (!attempt || attempt.requestId !== request.requestId || attempt.localDate !== request.localDate) {
        return missing('recommendation_attempt_not_found');
      }
      const preferenceSnapshots = attempt.preferences;
      const preferences = preferenceByInterest(preferenceSnapshots);
      const interests = attempt.interests.map((interest) => ({
          interestId: interest.interestId,
          description: interest.description,
          status: interest.status,
          interestRevision: interest.revision,
          preference: preferences.get(interest.interestId) ?? emptyPreference(interest.interestId),
        }));
      const facts: RecommendationFacts = {
        asOf: attempt.snapshotAt,
        execution: {
          requestId: attempt.requestId,
          localDate: attempt.localDate,
          actualTarget: attempt.actualTarget,
          eligibleCount: attempt.rankedCandidates.length,
          workingSetCount: attempt.workingSetCount,
        },
        interests,
        preferences: preferenceSnapshots.map(contextPreference),
        candidates: attempt.rankedCandidates.slice(0, attempt.workingSetCount).map((entry) => ({
          ...candidateSummary({ ...entry.candidate, sourceName: entry.sourceName }),
          matchedInterestIds: entry.interestMatches.map(({ interestId }) => interestId),
          interestMatches: entry.interestMatches.map(({ interestId, relevance, matchReason }) => ({
            interestId,
            relevance,
            matchReason,
          })),
        })),
        recentRecommendations: attempt.history.map((recommendation) => ({
          recommendationId: recommendation.id,
          contentIdentity: recommendation.contentIdentity,
          sourceName: recommendation.content.sourceName,
          contentType: recommendation.content.contentType,
          title: recommendation.content.title,
          recommendationReason: recommendation.recommendationReason,
          publishedAt: recommendation.publishedAt,
          matchedInterestIds: recommendation.selectionBasis.matchedInterestIds,
          ...(recommendation.state.reaction ? { reaction: recommendation.state.reaction } : {}),
        })),
        ranking: [
          ...attempt.rankedCandidates.map((entry) => ({
            candidateId: entry.candidate.id,
            eligible: true as const,
            rank: entry.rank,
            relevanceRank: entry.relevanceRank,
            rankingFacts: entry.rankingFacts,
          })),
          ...attempt.exclusions.map((entry) => ({
            candidateId: entry.candidateId,
            eligible: false as const,
            exclusionReason: entry.reason,
          })),
        ],
      };
      return { status: 'ok', facts };
    },

    async readPreferenceLearningFacts(request) {
      if (request.signal?.aborted) return { status: 'cancelled' };
      const facts = options.repository.getPreferenceLearningFacts(request.batchId);
      if (!facts) return missing('preference_learning_batch_not_found');
      const interests = options.repository.listNonDeletedInterests();
      const contextFacts: ContextPreferenceLearningFacts = {
        asOf: facts.batch.startedAt,
        batch: {
          batchId: facts.batch.batchId,
          startedAt: facts.batch.startedAt,
          changeCount: facts.batch.changeCount,
        },
        interests: interests.map((interest) => ({
          interestId: interest.interestId,
          description: interest.description,
          status: interest.status,
          revision: interest.revision,
        })),
        currentPreferences: facts.currentPreferences.map(contextPreference),
        reactionChanges: facts.reactionChanges.map((change) => ({
          recommendationId: change.recommendationId,
          ...(change.learnedReaction ? { learnedReaction: change.learnedReaction } : {}),
          learnedReactionRevision: change.learnedReactionRevision,
          ...(change.currentReaction ? { currentReaction: change.currentReaction } : {}),
          currentReactionRevision: change.currentReactionRevision,
          changedAt: change.changedAt,
          requiresCorrection: change.requiresCorrection,
          recommendation: {
            title: change.recommendation.title,
            sourceName: change.recommendation.sourceName,
            ...(change.recommendation.author ? { author: change.recommendation.author } : {}),
            contentType: change.recommendation.contentType,
            publishedAt: change.recommendation.publishedAt,
            recommendationReason: change.recommendation.recommendationReason,
            matchedInterestIds: change.recommendation.matchedInterestIds,
            contentEvidence: { ...change.recommendation.contentEvidence },
          },
          previouslySupportedDirectionIds: change.previouslySupportedDirectionIds,
        })),
      };
      return { status: 'ok', facts: contextFacts };
    },
  };
}

/** Projects Source Registry capability and cooldown facts without exposing adapters. */
export function createContextDiscoverySourceRegistry(options: {
  readonly sourceRegistry: SourceRegistry;
}): ContextDiscoverySourceRegistry {
  return {
    listContextSources({ at }) {
      return options.sourceRegistry.listSources().map(({ descriptor, availability }) => {
        const retryAt = availability.retryAt;
        return {
          sourceId: descriptor.id,
          name: descriptor.name,
          access: descriptor.access,
          supportedModes: descriptor.supportedModes,
          supportsRead: descriptor.supportsRead,
          availability: retryAt && Date.parse(retryAt) > Date.parse(at)
            ? 'cooling_down'
            : availability.state,
          ...(retryAt ? { retryAt } : {}),
        };
      });
    },
  };
}

function preferenceByInterest(
  snapshots: ReturnType<DiscoveryRepository['listPreferenceSnapshots']>,
): ReadonlyMap<string, ContextPreferenceSnapshot> {
  return new Map(snapshots.flatMap((snapshot) => snapshot.interestId
    ? [[snapshot.interestId, contextPreference(snapshot)] as const]
    : []));
}

function contextPreference(
  snapshot: ReturnType<DiscoveryRepository['listPreferenceSnapshots']>[number],
): ContextPreferenceSnapshot {
  return {
    scopeKey: snapshot.scopeKey,
    scope: snapshot.scope,
    ...(snapshot.interestId ? { interestId: snapshot.interestId } : {}),
    revision: snapshot.revision,
    directions: snapshot.directions.map((direction) => ({ ...direction })),
  };
}

function emptyPreference(interestId: string): ContextPreferenceSnapshot {
  return {
    scopeKey: `interest:${interestId}`,
    scope: 'interest',
    interestId,
    revision: 0,
    directions: [],
  };
}

function candidateSummary(candidate: {
  readonly id: string;
  readonly contentIdentity: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly contentType: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly contentSummary: string;
  readonly contentExcerpt?: string;
  readonly contentTruncated: boolean;
}) {
  return {
    candidateId: candidate.id,
    contentIdentity: candidate.contentIdentity,
    sourceId: candidate.sourceId,
    sourceName: candidate.sourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    contentSummary: candidate.contentSummary,
    contentTruncated: candidate.contentTruncated,
    evidenceCompleteness: candidate.contentExcerpt
      ? candidate.contentTruncated ? 'partial' as const : 'full' as const
      : candidate.description ? 'partial' as const : 'metadata_only' as const,
  };
}

function missing(code: string) {
  return Promise.resolve({
    status: 'failed' as const,
    failure: { code, message: 'The requested Discovery Context facts are unavailable.' },
  });
}
