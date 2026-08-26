/*
 * Owns deterministic Candidate Pool thresholds, expiry, state transitions, and query normalization.
 */
import type {
  Candidate,
  CandidatePoolGap,
  CandidateStatus,
  CandidateSupplyThresholds,
} from './candidate-supply';

const DAY_MS = 24 * 60 * 60 * 1000;

const LEGAL_TRANSITIONS: Readonly<Record<CandidateStatus, ReadonlySet<CandidateStatus>>> = {
  preparing: new Set(['pending_admission', 'expired']),
  pending_admission: new Set(['preparing', 'available', 'rejected', 'expired']),
  available: new Set(['reserved', 'pending_admission', 'expired']),
  reserved: new Set(['consumed', 'available', 'expired']),
  consumed: new Set(),
  rejected: new Set(['pending_admission', 'expired']),
  expired: new Set(['preparing', 'pending_admission']),
};

export function candidateSupplyThresholds(
  dailyTargetCount: number,
  proactiveTargetCount: number,
): CandidateSupplyThresholds {
  const daily = requireNonNegativeInteger(dailyTargetCount, 'dailyTargetCount');
  const proactive = requireNonNegativeInteger(proactiveTargetCount, 'proactiveTargetCount');
  const target = (2 * daily) + proactive;
  return { lowWatermark: daily + proactive, target, hardLimit: 2 * target };
}

export function candidatePoolGap(input: {
  readonly availableCount: number;
  readonly thresholds: CandidateSupplyThresholds;
  readonly uncoveredInterestIds: readonly string[];
  readonly dailyShortfall?: number;
  readonly proactiveShortfall?: number;
}): CandidatePoolGap {
  const consumerShortfalls = [
    ...(input.dailyShortfall && input.dailyShortfall > 0
      ? [{ consumer: 'daily' as const, count: input.dailyShortfall }]
      : []),
    ...(input.proactiveShortfall && input.proactiveShortfall > 0
      ? [{ consumer: 'proactive' as const, count: input.proactiveShortfall }]
      : []),
  ];
  return {
    totalShortfall: input.availableCount < input.thresholds.lowWatermark
      ? Math.max(0, input.thresholds.target - input.availableCount)
      : 0,
    uncoveredInterestIds: [...new Set(input.uncoveredInterestIds)].sort(),
    consumerShortfalls,
  };
}

export function hasCandidatePoolGap(gap: CandidatePoolGap): boolean {
  return gap.totalShortfall > 0
    || gap.uncoveredInterestIds.length > 0
    || gap.consumerShortfalls.some((shortfall) => shortfall.count > 0);
}

export function assertCandidateTransition(from: CandidateStatus, to: CandidateStatus): void {
  if (from === to || LEGAL_TRANSITIONS[from].has(to)) return;
  throw new Error(`Invalid Candidate state transition: ${from} -> ${to}.`);
}

export function candidateExpiresAt(
  contentType: Candidate['contentType'],
  from: string,
  status: 'preparing' | 'pending_admission' | 'available',
): string {
  const base = Date.parse(from);
  if (!Number.isFinite(base)) throw new Error('Expected an ISO timestamp.');
  const days = status === 'preparing' || status === 'pending_admission'
    ? 1
    : contentType === 'news'
      ? 3
      : contentType === 'post'
        ? 7
        : 30;
  return new Date(base + (days * DAY_MS)).toISOString();
}

export function normalizeCandidateQuery(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

export function candidateQueryKey(input: {
  readonly sourceId: string;
  readonly query: string;
  readonly mode: 'relevance' | 'recent';
  readonly targetInterestIds: readonly string[];
}): string {
  return JSON.stringify([
    input.sourceId,
    input.mode,
    [...new Set(input.targetInterestIds)].sort(),
    normalizeCandidateQuery(input.query),
  ]);
}

export function isCandidateContentAssessable(content: {
  readonly description?: string;
  readonly contentText?: string;
}): boolean {
  return Boolean(content.description?.trim() || content.contentText?.trim());
}

function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}
