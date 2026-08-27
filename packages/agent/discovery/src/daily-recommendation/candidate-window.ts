/*
 * Builds a bounded and Interest-balanced Candidate Pool window without making the final recommendation decision.
 */
import type {
  DailyCandidateWindow,
  DailyRecommendationCandidate,
} from './daily-recommendation';

const MINIMUM_WINDOW_SIZE = 40;
const TARGET_WINDOW_MULTIPLIER = 3;

export interface BuildDailyCandidateWindowInput {
  readonly now: string;
  readonly requestedCount: number;
  readonly activeInterestIds: readonly string[];
  readonly candidates: readonly DailyRecommendationCandidate[];
}

/** Selects the deterministic representative window that the Agent may evaluate. */
export function buildDailyCandidateWindow(input: BuildDailyCandidateWindowInput): DailyCandidateWindow {
  const nowMs = parseTimestamp(input.now, 'now');
  const requestedCount = requireRequestedCount(input.requestedCount);
  const eligible = input.candidates
    .filter((candidate) => candidate.status === 'available' && Date.parse(candidate.expiresAt) > nowMs);
  const availableCount = eligible.length;
  const actualTarget = Math.min(requestedCount, availableCount);
  const windowLimit = Math.min(availableCount, Math.max(TARGET_WINDOW_MULTIPLIER * requestedCount, MINIMUM_WINDOW_SIZE));

  return {
    requestedCount,
    actualTarget,
    availableCount,
    windowLimit,
    candidates: buildRepresentativeOrder(input.activeInterestIds, eligible).slice(0, windowLimit),
  };
}

/** Interleaves stable Interest queues and one exploration lane without selecting final recommendations. */
function buildRepresentativeOrder(
  activeInterestIds: readonly string[],
  candidates: readonly DailyRecommendationCandidate[],
): readonly DailyRecommendationCandidate[] {
  const interestIds = [...new Set(activeInterestIds)];
  const interestQueues = interestIds.map((interestId) => candidates
    .filter((candidate) => candidate.admission.matchedInterestIds.includes(interestId))
    .sort(compareInterestCandidate));
  const explorationQueue = candidates
    .filter((candidate) => candidate.admission.relevance === 'exploration')
    .sort(compareOldestAvailable);
  const ordered: DailyRecommendationCandidate[] = [];
  const used = new Set<string>();

  while (ordered.length < candidates.length) {
    let added = false;
    for (const queue of interestQueues) {
      const candidate = nextUnused(queue, used);
      if (!candidate) continue;
      ordered.push(candidate);
      used.add(candidate.candidateId);
      added = true;
    }
    const exploration = nextUnused(explorationQueue, used);
    if (exploration) {
      ordered.push(exploration);
      used.add(exploration.candidateId);
      added = true;
    }
    if (!added) break;
  }

  const remaining = candidates.filter(({ candidateId }) => !used.has(candidateId)).sort(compareInterestCandidate);
  return [...ordered, ...remaining];
}

function nextUnused(
  queue: readonly DailyRecommendationCandidate[],
  used: ReadonlySet<string>,
): DailyRecommendationCandidate | undefined {
  return queue.find(({ candidateId }) => !used.has(candidateId));
}

function compareInterestCandidate(left: DailyRecommendationCandidate, right: DailyRecommendationCandidate): number {
  const relevance = relevanceRank(left.admission.relevance) - relevanceRank(right.admission.relevance);
  return relevance || compareOldestAvailable(left, right);
}

function relevanceRank(relevance: DailyRecommendationCandidate['admission']['relevance']): number {
  if (relevance === 'direct') return 0;
  if (relevance === 'adjacent') return 1;
  return 2;
}

function compareOldestAvailable(left: DailyRecommendationCandidate, right: DailyRecommendationCandidate): number {
  return left.statusUpdatedAt.localeCompare(right.statusUpdatedAt)
    || left.candidateId.localeCompare(right.candidateId);
}

function requireRequestedCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('Daily Recommendation requestedCount must be an integer between 1 and 100.');
  }
  return value;
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid timestamp.`);
  return parsed;
}
