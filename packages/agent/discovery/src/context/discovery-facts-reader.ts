/*
 * Adapts Discovery-owned repositories and execution attempts to the Context
 * consumer seam. It exposes normalized authoritative facts and never builds a
 * Prompt or chooses model-visible limits.
 */
import type {
  CandidateSupplyFacts,
  ContextDiscoverySourceRegistry,
  ContextPreferenceSnapshot,
  DailyRecommendationFacts,
  DiscoveryFactsReader,
  PreferenceLearningFacts as ContextPreferenceLearningFacts,
} from '@megumi/context';
import type { CandidateSupplyAttempts } from '../candidate-supply/candidate-supply-attempts';
import type { DailyRecommendationAttempts } from '../daily-recommendation/daily-recommendation-attempt';
import type { DiscoveryRepository } from '../persistence/discovery-repository';
import type { SourceRegistry } from '../sources/source-registry';

/** Creates the production read adapter used by all three Discovery Context resolvers. */
export function createDiscoveryFactsReader(options: {
  readonly repository: DiscoveryRepository;
  readonly candidateSupplyAttempts: CandidateSupplyAttempts;
  readonly dailyRecommendationAttempts: DailyRecommendationAttempts;
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

    async readDailyRecommendationFacts(request) {
      if (request.signal?.aborted) return { status: 'cancelled' };
      const attempt = options.dailyRecommendationAttempts.readContextSnapshot(request.executionId);
      if (!attempt || attempt.batchId !== request.batchId) {
        return missing('daily_recommendation_attempt_not_found');
      }
      const batch = options.repository.getBatch(request.localDate);
      if (!batch || batch.batchId !== request.batchId) return missing('daily_batch_not_found');
      const preferenceSnapshots = options.repository.listPreferenceSnapshots();
      const preferences = preferenceByInterest(preferenceSnapshots);
      const interests = options.repository.listNonDeletedInterests()
        .filter(({ status }) => status === 'active')
        .map((interest) => ({
          interestId: interest.interestId,
          description: interest.description,
          status: interest.status,
          interestRevision: interest.revision,
          preference: preferences.get(interest.interestId) ?? emptyPreference(interest.interestId),
        }));
      const snapshot = attempt.snapshot;
      const facts: DailyRecommendationFacts = {
        asOf: batch.updatedAt,
        batch: {
          batchId: batch.batchId,
          localDate: batch.localDate,
          requestedCount: snapshot.window.requestedCount,
          actualTarget: snapshot.window.actualTarget,
          availableCount: snapshot.window.availableCount,
          readBudget: Math.min(snapshot.window.candidates.length, 20),
        },
        interests,
        explorationPreference: explorationPreference(preferenceSnapshots),
        candidates: snapshot.window.candidates.map((candidate) => ({
          ...candidateSummary(candidate),
          selectionReason: candidate.selectionReason,
          matchedInterestIds: candidate.interestMatches.map(({ interestId }) => interestId),
          interestMatches: candidate.interestMatches.map(({ interestId, relevance }) => ({
            interestId,
            relevance,
          })),
        })),
        recentRecommendations: snapshot.recentRecommendations.map((recommendation) => ({
          contentIdentity: recommendation.contentIdentity,
          sourceName: recommendation.sourceName,
          title: recommendation.title,
          recommendationReason: recommendation.recommendationReason,
          publishedAt: recommendation.publishedAt,
        })),
        pendingFeedback: snapshot.pendingFeedback.map((feedback) => ({ ...feedback })),
        omittedPendingFeedbackCount: snapshot.omittedPendingFeedbackCount,
      };
      return { status: 'ok', facts };
    },

    async readPreferenceLearningFacts(request) {
      if (request.signal?.aborted) return { status: 'cancelled' };
      const facts = options.repository.readPreferenceLearningFacts(request.batchId);
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
        feedbackChanges: facts.feedbackChanges.map((change) => ({
          feedbackChangeId: change.feedbackChangeId,
          feedbackId: change.feedbackId,
          recommendationId: change.recommendationId,
          ...(change.previousReaction ? { previousReaction: change.previousReaction } : {}),
          ...(change.currentReaction ? { currentReaction: change.currentReaction } : {}),
          feedbackRevision: change.feedbackRevision,
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

function explorationPreference(
  snapshots: ReturnType<DiscoveryRepository['listPreferenceSnapshots']>,
): ContextPreferenceSnapshot {
  const snapshot = snapshots.find(({ scope }) => scope === 'exploration');
  return snapshot ? contextPreference(snapshot) : {
    scopeKey: 'exploration',
    scope: 'exploration',
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
    evidenceCompleteness: candidate.description ? 'partial' as const : 'metadata_only' as const,
  };
}

function missing(code: string) {
  return Promise.resolve({
    status: 'failed' as const,
    failure: { code, message: 'The requested Discovery Context facts are unavailable.' },
  });
}
