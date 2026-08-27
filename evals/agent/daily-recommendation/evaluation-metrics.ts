/*
 * Derives Daily Recommendation metrics and deterministic verdicts from fixed context,
 * model Tool calls, and the Recommendation rows committed by the business Owner.
 */
import type { DailyRecommendationCandidate } from '@megumi/discovery';

export type EvaluatedCandidateRelevance = DailyRecommendationCandidate['admission']['relevance'];

export interface DailyRecommendationEvaluationCandidate {
  readonly candidateId: string;
  readonly contentIdentity: string;
  readonly topicKey: string;
  readonly relevance: EvaluatedCandidateRelevance;
  readonly matchedInterestIds: readonly string[];
  readonly summarySufficient: boolean;
}

export interface DailyRecommendationEvaluationFeedback {
  readonly topicKey: string;
  readonly signal: 'liked' | 'disliked' | 'hidden' | 'favorite' | 'watch_later';
}

export type DailyRecommendationEvaluationToolCall =
  | {
      readonly name: 'read_pool_candidate';
      readonly candidateId: string;
      readonly status: 'succeeded' | 'failed';
    }
  | {
      readonly name: 'publish_daily_recommendations';
      readonly candidateIds: readonly string[];
      readonly status: 'published' | 'already_published' | 'selection_conflict' | 'rejected';
    };

export interface DailyRecommendationEvaluationObservation {
  readonly batch: {
    readonly requestedCount: number;
    readonly actualTarget: number;
  };
  readonly modelCallCount: number;
  readonly toolCalls: readonly DailyRecommendationEvaluationToolCall[];
  /** Final immutable Recommendation rows ordered by their persisted position. */
  readonly recommendations: readonly {
    readonly candidateId: string;
    readonly recommendationReason: string;
  }[];
}

export interface DailyRecommendationEvaluationCase {
  readonly caseId: string;
  readonly description: string;
  readonly fixedNow: string;
  readonly activeInterestIds: readonly string[];
  readonly windowCandidates: readonly DailyRecommendationEvaluationCandidate[];
  readonly recentTopicKeys: readonly string[];
  readonly feedback: readonly DailyRecommendationEvaluationFeedback[];
  readonly observation: DailyRecommendationEvaluationObservation;
  readonly expected: {
    readonly selectedCandidateIds: readonly string[];
    readonly excludedCandidateIds?: readonly string[];
    readonly readCandidateIds: readonly string[];
    readonly publicationStatuses: readonly Extract<
      DailyRecommendationEvaluationToolCall,
      { readonly name: 'publish_daily_recommendations' }
    >['status'][];
  };
}

export interface DailyRecommendationEvaluationMetrics {
  readonly requestedCount: number;
  readonly actualTarget: number;
  readonly windowCount: number;
  readonly publishedCount: number;
  readonly interestCoverage: {
    readonly window: number;
    readonly published: number;
  };
  readonly relevance: {
    readonly window: Readonly<Record<EvaluatedCandidateRelevance, number>>;
    readonly published: Readonly<Record<EvaluatedCandidateRelevance, number>>;
  };
  readonly calls: {
    readonly model: number;
    readonly read: number;
    readonly publish: number;
  };
  readonly publicationAttempts: number;
  readonly conflicts: number;
}

export interface DailyRecommendationEvaluationResult {
  readonly passed: boolean;
  readonly issues: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly metrics: DailyRecommendationEvaluationMetrics;
}

export function evaluateDailyRecommendationCase(
  evaluationCase: DailyRecommendationEvaluationCase,
): DailyRecommendationEvaluationResult {
  const issues: Array<{ code: string; message: string }> = [];
  const { observation } = evaluationCase;
  const windowIds = new Set(evaluationCase.windowCandidates.map(({ candidateId }) => candidateId));
  const selectedIds = observation.recommendations.map(({ candidateId }) => candidateId);
  const publishCalls = observation.toolCalls.filter((call) => call.name === 'publish_daily_recommendations');
  const readIds = observation.toolCalls.flatMap((call) => (
    call.name === 'read_pool_candidate' && call.status === 'succeeded' ? [call.candidateId] : []
  ));

  requireNonNegativeInteger(observation.batch.requestedCount, 'requested_count_invalid', issues);
  requireNonNegativeInteger(observation.batch.actualTarget, 'actual_target_invalid', issues);
  requireNonNegativeInteger(observation.modelCallCount, 'model_call_count_invalid', issues);
  if (observation.batch.actualTarget > observation.batch.requestedCount) {
    addIssue(issues, 'actual_target_exceeds_request', 'Actual target exceeds the requested count.');
  }
  if (observation.batch.actualTarget > evaluationCase.windowCandidates.length) {
    addIssue(issues, 'actual_target_exceeds_window', 'Actual target exceeds the fixed Candidate window.');
  }
  if (selectedIds.length !== observation.batch.actualTarget) {
    addIssue(issues, 'published_count_mismatch', 'Published Recommendation count does not equal the actual target.');
  }
  if (new Set(selectedIds).size !== selectedIds.length) {
    addIssue(issues, 'duplicate_selection', 'The final selection contains a duplicate Candidate.');
  }
  for (const recommendation of observation.recommendations) {
    if (!windowIds.has(recommendation.candidateId)) {
      addIssue(issues, 'candidate_outside_window', `Candidate ${recommendation.candidateId} was not in the fixed window.`);
    }
    if (recommendation.recommendationReason.trim().length === 0) {
      addIssue(issues, 'missing_recommendation_reason', `Candidate ${recommendation.candidateId} has no recommendation reason.`);
    }
  }

  const successfulPublication = [...publishCalls].reverse().find((call) => (
    call.status === 'published' || call.status === 'already_published'
  ));
  if (!successfulPublication) {
    addIssue(issues, 'publication_missing', 'No successful terminal publication Tool call was observed.');
  } else if (!sameOrder(successfulPublication.candidateIds, selectedIds)) {
    addIssue(issues, 'publication_table_mismatch', 'The terminal Tool selection differs from persisted Recommendation order.');
  }

  if (!sameOrder(selectedIds, evaluationCase.expected.selectedCandidateIds)) {
    addIssue(issues, 'unexpected_selection', 'The final ordered selection differs from this Case expectation.');
  }
  for (const candidateId of evaluationCase.expected.excludedCandidateIds ?? []) {
    if (selectedIds.includes(candidateId)) {
      addIssue(issues, 'excluded_candidate_selected', `Excluded Candidate ${candidateId} was published.`);
    }
  }
  if (!sameOrder(readIds, evaluationCase.expected.readCandidateIds)) {
    addIssue(issues, 'unexpected_read_sequence', 'Successful full-content reads differ from this Case expectation.');
  }
  if (!sameOrder(
    publishCalls.map(({ status }) => status),
    evaluationCase.expected.publicationStatuses,
  )) {
    addIssue(issues, 'unexpected_publication_sequence', 'Publication outcomes differ from this Case expectation.');
  }

  return {
    passed: issues.length === 0,
    issues,
    metrics: calculateDailyRecommendationMetrics(evaluationCase),
  };
}

export function calculateDailyRecommendationMetrics(
  evaluationCase: Pick<
    DailyRecommendationEvaluationCase,
    'activeInterestIds' | 'windowCandidates' | 'observation'
  >,
): DailyRecommendationEvaluationMetrics {
  const { observation, windowCandidates } = evaluationCase;
  const byId = new Map(windowCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const publishedCandidates = observation.recommendations.flatMap(({ candidateId }) => {
    const candidate = byId.get(candidateId);
    return candidate ? [candidate] : [];
  });
  const publishCalls = observation.toolCalls.filter((call) => call.name === 'publish_daily_recommendations');

  return {
    requestedCount: observation.batch.requestedCount,
    actualTarget: observation.batch.actualTarget,
    windowCount: windowCandidates.length,
    publishedCount: observation.recommendations.length,
    interestCoverage: {
      window: interestCoverage(windowCandidates, evaluationCase.activeInterestIds),
      published: interestCoverage(publishedCandidates, evaluationCase.activeInterestIds),
    },
    relevance: {
      window: relevanceCounts(windowCandidates),
      published: relevanceCounts(publishedCandidates),
    },
    calls: {
      model: observation.modelCallCount,
      read: observation.toolCalls.filter((call) => call.name === 'read_pool_candidate').length,
      publish: publishCalls.length,
    },
    publicationAttempts: publishCalls.length,
    conflicts: publishCalls.filter(({ status }) => status === 'selection_conflict').length,
  };
}

function interestCoverage(
  candidates: readonly DailyRecommendationEvaluationCandidate[],
  activeInterestIds: readonly string[],
): number {
  const active = new Set(activeInterestIds);
  return new Set(candidates.flatMap(({ matchedInterestIds }) => (
    matchedInterestIds.filter((interestId) => active.has(interestId))
  ))).size;
}

function relevanceCounts(
  candidates: readonly DailyRecommendationEvaluationCandidate[],
): Readonly<Record<EvaluatedCandidateRelevance, number>> {
  return {
    direct: candidates.filter(({ relevance }) => relevance === 'direct').length,
    adjacent: candidates.filter(({ relevance }) => relevance === 'adjacent').length,
    exploration: candidates.filter(({ relevance }) => relevance === 'exploration').length,
  };
}

function requireNonNegativeInteger(
  value: number,
  code: string,
  issues: Array<{ code: string; message: string }>,
): void {
  if (!Number.isInteger(value) || value < 0) addIssue(issues, code, `${value} must be a non-negative integer.`);
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addIssue(
  issues: Array<{ code: string; message: string }>,
  code: string,
  message: string,
): void {
  issues.push({ code, message });
}
