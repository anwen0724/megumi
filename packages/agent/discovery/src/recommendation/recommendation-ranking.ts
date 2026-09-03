/* Builds Recommendation's complete deterministic coarse ranking from one immutable snapshot. */
import type {
  RankedRecommendationCandidate,
  RecommendationCandidate,
  RecommendationExclusionReason,
  RecommendationHistoryItem,
  RecommendationRankingResult,
} from './recommendation';

const HISTORY_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

export interface RankRecommendationCandidatesInput {
  readonly snapshotAt: string;
  readonly targetCount: number;
  readonly workingSetCount: number;
  readonly candidates: readonly RecommendationCandidate[];
  readonly history: readonly RecommendationHistoryItem[];
}

/** Ranks every objectively eligible Candidate before applying the configured working-set boundary. */
export function rankRecommendationCandidates(
  input: RankRecommendationCandidatesInput,
): RecommendationRankingResult {
  const snapshotMs = timestamp(input.snapshotAt, 'snapshotAt');
  const targetCount = positiveInteger(input.targetCount, 'targetCount');
  const workingSetCount = positiveInteger(input.workingSetCount, 'workingSetCount');
  if (workingSetCount < targetCount) throw new Error('workingSetCount cannot be smaller than targetCount.');

  const history = input.history.filter(({ publishedAt }) => (
    snapshotMs - timestamp(publishedAt, 'history.publishedAt') <= HISTORY_WINDOW_MS
  ));
  const recommendedCandidateIds = new Set(input.history.map(({ candidateId }) => candidateId));
  const recommendedIdentities = new Set(input.history.map(({ contentIdentity }) => contentIdentity));
  const exclusions: { readonly candidateId: string; readonly reason: RecommendationExclusionReason }[] = [];
  const eligible = input.candidates.filter((candidate) => {
    const reason = exclusionReason(candidate, snapshotMs, recommendedCandidateIds, recommendedIdentities);
    if (!reason) return true;
    exclusions.push({ candidateId: candidate.candidate.id, reason });
    return false;
  });

  const remaining = eligible.map((candidate) => ({
    ...candidate,
    primaryInterestId: primaryInterest(candidate, history),
  }));
  const ranked: RankedRecommendationCandidate[] = [];
  const currentInterests = new Map<string, number>();
  const currentSources = new Map<string, number>();
  const currentContentTypes = new Map<string, number>();

  while (remaining.length > 0) {
    remaining.sort((left, right) => compareCandidate(
      left,
      right,
      history,
      currentInterests,
      currentSources,
      currentContentTypes,
    ));
    const selected = remaining.shift();
    if (!selected) break;
    const rankingFacts = factsFor(
      selected,
      history,
      currentInterests,
      currentSources,
      currentContentTypes,
    );
    ranked.push({
      ...selected,
      rank: ranked.length,
      relevanceRank: bestRelevanceRank(selected),
      rankingFacts,
    });
    increment(currentInterests, selected.primaryInterestId);
    increment(currentSources, selected.candidate.sourceId);
    increment(currentContentTypes, selected.candidate.contentType);
  }

  return {
    eligibleCount: ranked.length,
    actualTargetCount: Math.min(targetCount, ranked.length),
    rankedCandidates: ranked,
    initialWorkingSet: ranked.slice(0, workingSetCount),
    exclusions,
  };
}

function exclusionReason(
  value: RecommendationCandidate,
  snapshotMs: number,
  recommendedCandidateIds: ReadonlySet<string>,
  recommendedIdentities: ReadonlySet<string>,
): RecommendationExclusionReason | undefined {
  const candidate = value.candidate;
  if (candidate.status !== 'available') return 'not_available';
  if (timestamp(candidate.expiresAt, 'candidate.expiresAt') <= snapshotMs) return 'expired';
  if (value.interestMatches.length === 0) return 'no_active_interest_match';
  if (recommendedCandidateIds.has(candidate.id) || recommendedIdentities.has(candidate.contentIdentity)) {
    return 'already_recommended';
  }
  if (!value.sourceName.trim()) return 'source_unavailable';
  return undefined;
}

function primaryInterest(
  candidate: RecommendationCandidate,
  history: readonly RecommendationHistoryItem[],
): string {
  const matches = [...candidate.interestMatches].sort((left, right) => (
    relevanceRank(left.relevance) - relevanceRank(right.relevance)
    || historicalInterestCount(history, left.interestId) - historicalInterestCount(history, right.interestId)
    || left.interestId.localeCompare(right.interestId)
  ));
  const primary = matches[0];
  if (!primary) throw new Error('Eligible Candidate requires an Interest match.');
  return primary.interestId;
}

type CandidateWithPrimaryInterest = RecommendationCandidate & { readonly primaryInterestId: string };

function compareCandidate(
  left: CandidateWithPrimaryInterest,
  right: CandidateWithPrimaryInterest,
  history: readonly RecommendationHistoryItem[],
  currentInterests: ReadonlyMap<string, number>,
  currentSources: ReadonlyMap<string, number>,
  currentContentTypes: ReadonlyMap<string, number>,
): number {
  const leftFacts = factsFor(left, history, currentInterests, currentSources, currentContentTypes);
  const rightFacts = factsFor(right, history, currentInterests, currentSources, currentContentTypes);
  return bestRelevanceRank(left) - bestRelevanceRank(right)
    || leftFacts.currentInterestCount - rightFacts.currentInterestCount
    || leftFacts.historicalInterestCount - rightFacts.historicalInterestCount
    || leftFacts.currentSourceCount - rightFacts.currentSourceCount
    || leftFacts.historicalSourceCount - rightFacts.historicalSourceCount
    || leftFacts.currentContentTypeCount - rightFacts.currentContentTypeCount
    || leftFacts.historicalContentTypeCount - rightFacts.historicalContentTypeCount
    || compareOptionalTimestampDesc(left.candidate.publishedAt, right.candidate.publishedAt)
    || right.candidate.createdAt.localeCompare(left.candidate.createdAt)
    || left.candidate.id.localeCompare(right.candidate.id);
}

function factsFor(
  value: CandidateWithPrimaryInterest,
  history: readonly RecommendationHistoryItem[],
  currentInterests: ReadonlyMap<string, number>,
  currentSources: ReadonlyMap<string, number>,
  currentContentTypes: ReadonlyMap<string, number>,
): RankedRecommendationCandidate['rankingFacts'] {
  return {
    currentInterestCount: currentInterests.get(value.primaryInterestId) ?? 0,
    historicalInterestCount: historicalInterestCount(history, value.primaryInterestId),
    currentSourceCount: currentSources.get(value.candidate.sourceId) ?? 0,
    historicalSourceCount: history.filter(({ sourceId }) => sourceId === value.candidate.sourceId).length,
    currentContentTypeCount: currentContentTypes.get(value.candidate.contentType) ?? 0,
    historicalContentTypeCount: history.filter(({ contentType }) => (
      contentType === value.candidate.contentType
    )).length,
  };
}

function historicalInterestCount(
  history: readonly RecommendationHistoryItem[],
  interestId: string,
): number {
  return history.filter(({ matchedInterestIds }) => matchedInterestIds.includes(interestId)).length;
}

function bestRelevanceRank(candidate: RecommendationCandidate): number {
  return Math.min(...candidate.interestMatches.map(({ relevance }) => relevanceRank(relevance)));
}

function relevanceRank(value: 'direct' | 'adjacent' | 'exploration'): number {
  if (value === 'direct') return 0;
  if (value === 'adjacent') return 1;
  return 2;
}

function compareOptionalTimestampDesc(left: string | undefined, right: string | undefined): number {
  if (left && right) return right.localeCompare(left);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp.`);
  return parsed;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer.`);
  return value;
}
