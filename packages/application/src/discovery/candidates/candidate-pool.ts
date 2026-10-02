/*
 * Owns deterministic Candidate Pool settings, expiry, and state transitions.
 */
import type { CandidatePoolSettings, CandidateStatus } from './candidate-supply';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Derives and validates the Candidate Pool settings used by every read and submission. */
export function candidatePoolSettings(input: {
  readonly minimumCount: number;
  readonly maximumCount: number;
  readonly candidateValidityDays: number;
  readonly candidateContentExcerptMaxCharacters: number;
}): CandidatePoolSettings {
  const minimumCount = positiveInteger(input.minimumCount, 'minimumCount');
  const maximumCount = positiveInteger(input.maximumCount, 'maximumCount');
  const candidateValidityDays = positiveInteger(input.candidateValidityDays, 'candidateValidityDays');
  const candidateContentExcerptMaxCharacters = positiveInteger(
    input.candidateContentExcerptMaxCharacters,
    'candidateContentExcerptMaxCharacters',
  );
  const targetCount = Math.floor(maximumCount * 0.8);
  if (minimumCount >= targetCount) {
    throw new Error('minimumCount must be lower than 80% of maximumCount.');
  }
  return {
    minimumCount,
    targetCount,
    maximumCount,
    candidateValidityDays,
    candidateContentExcerptMaxCharacters,
  };
}

/** Calculates Candidate expiry from its creation time and the configured common validity. */
export function candidateExpiresAt(createdAt: string, candidateValidityDays: number): string {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) throw new Error('createdAt must be a valid timestamp.');
  return new Date(timestamp + positiveInteger(candidateValidityDays, 'candidateValidityDays') * DAY_MS)
    .toISOString();
}

/** Protects the only two legal Candidate state transitions. */
export function assertCandidateTransition(from: CandidateStatus, to: CandidateStatus): void {
  if (from === to) return;
  if (from === 'available' && (to === 'consumed' || to === 'expired')) return;
  throw new Error(`Invalid Candidate state transition: ${from} -> ${to}.`);
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
