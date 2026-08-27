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
      const preferenceSnapshots = options.repository.listPreferenceSnapshots();
      const preferences = preferenceByInterest(preferenceSnapshots);
      const facts: CandidateSupplyFacts = {
        asOf: attempt.asOf,
        executionId: request.executionId,
        startedAt: attempt.startedAt,
        trigger: attempt.trigger,
        pool: {
          counts: attempt.snapshot.counts,
          lowWatermark: attempt.snapshot.thresholds.lowWatermark,
          target: attempt.snapshot.thresholds.target,
          hardLimit: attempt.snapshot.thresholds.hardLimit,
          totalShortfall: attempt.snapshot.gap.totalShortfall,
          uncoveredInterestIds: attempt.snapshot.gap.uncoveredInterestIds,
          consumerShortfalls: attempt.snapshot.gap.consumerShortfalls,
        },
        interests: options.repository.listInterests()
          .filter(({ status }) => status === 'active')
          .map((interest) => ({
            interestId: interest.interestId,
            description: interest.description,
            status: interest.status,
            interestRevision: interest.revision,
            preference: preferences.get(interest.interestId) ?? emptyPreference(interest.interestId),
          })),
        explorationPreference: explorationPreference(preferenceSnapshots),
        negativeConstraints: options.repository.listNegativeConstraints(),
        recentQueryOutcomes: options.repository.listRecentQueryOutcomes({
          now: attempt.asOf, withinDays: 30, limit: 50,
        }).map((query) => ({
          queryId: query.queryId,
          query: query.query,
          sourceId: query.sourceId,
          mode: query.mode,
          targetInterestIds: query.targetInterestIds,
          status: query.status === 'interrupted' ? 'cancelled' : query.status,
          normalizedResultCount: Math.max(0, query.rawResultCount - query.invalidResultCount),
          newCandidateCount: query.newCandidateCount,
          mergedCandidateCount: query.mergedCandidateCount,
          alreadyRecommendedCount: query.alreadyRecommendedCount,
          capacityRejectedCount: query.capacityRejectedCount,
          ...(query.failureCode ? { failureCode: query.failureCode } : {}),
          ...(query.completedAt ? { completedAt: query.completedAt } : {}),
        })),
        pendingCandidates: attempt.snapshot.pendingCandidates.map((candidate) => ({
          candidate: candidateSummary(candidate),
          potentialDuplicates: options.repository
            .listPotentialDuplicates(candidate.candidateId, 10)
            .map((duplicate) => ({
              kind: duplicate.kind,
              identity: duplicate.id,
              title: duplicate.title,
              similarity: 'semantic' as const,
            })),
        })),
        budget: attempt.budget,
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
      const interests = options.repository.listInterests()
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
          assessmentId: candidate.admission.assessmentId,
          assessmentVersion: candidate.admission.assessmentVersion,
          relevance: candidate.admission.relevance,
          matchedInterestIds: candidate.admission.matchedInterestIds,
          admissionReason: candidate.admission.reason,
          interestRevisions: candidate.admission.interestRevisions,
          preferenceRevisions: candidate.admission.preferenceRevisions,
          preferenceAlignment: candidate.admission.preferenceAlignment,
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
      const interests = options.repository.listInterests();
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
  readonly repository: DiscoveryRepository;
}): ContextDiscoverySourceRegistry {
  return {
    listContextSources({ at }) {
      return options.sourceRegistry.listSources().map(({ descriptor, availability }) => {
        const persisted = options.repository.readSourceState(descriptor.id);
        const retryAt = latestTimestamp(availability.retryAt, persisted?.retryAt);
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
  readonly candidateId: string;
  readonly contentIdentity: string;
  readonly primarySourceId: string;
  readonly primarySourceName: string;
  readonly canonicalUrl: string;
  readonly contentType: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly contentText?: string;
}) {
  return {
    candidateId: candidate.candidateId,
    contentIdentity: candidate.contentIdentity,
    sourceId: candidate.primarySourceId,
    sourceName: candidate.primarySourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    evidenceCompleteness: candidate.contentText ? 'full' as const
      : candidate.description ? 'partial' as const
        : 'metadata_only' as const,
  };
}

function missing(code: string) {
  return Promise.resolve({
    status: 'failed' as const,
    failure: { code, message: 'The requested Discovery Context facts are unavailable.' },
  });
}

function latestTimestamp(...values: readonly (string | undefined)[]): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}
