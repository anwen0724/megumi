/*
 * Owns search backoff: the wait a (interest, pool) pair earns after a round
 * searched it without gaining an effective candidate. The module decides which
 * pairs a round may still search, which planned items to refuse, and what the
 * end of the round records. It only ever slows searches down: thresholds,
 * targets, matching, and pool relations are none of its business.
 */
import type { CandidatePool, SupplyHealth } from '../candidates/candidate-contracts';
import type { PendingGap } from '../discovery/plan-searches';
import {
  searchBackoffKey,
  type SearchBackoffRecord,
} from '../discovery/search-storage';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
import type { SupplyExecutionConfig } from './read-supply-config';
import type { SupplyIssue } from './supply-contracts';

const HOUR_MS = 60 * 60 * 1_000;

/** Backoff records indexed by the (interest, pool) key a round looks them up with. */
export type SearchBackoffIndex = ReadonlyMap<string, SearchBackoffRecord>;

/** The (interest, pool) pairs whose searches succeeded during this round. */
export type SearchedPairs = ReadonlySet<string>;

/**
 * Whether one interest and pool pair is still inside its wait.
 */
function isBackedOff(
  pair: { readonly interestId: string; readonly pool: CandidatePool },
  index: SearchBackoffIndex,
  now: number,
): boolean {
  const record = index.get(searchBackoffKey(pair));
  return record !== undefined && record.nextAllowedAt > now;
}

/**
 * Drops the health entries whose pair is still waiting, so planning never sees
 * them. A whole-pool entry goes with them once every interest in it waits:
 * nothing in that pool can be searched for, so there is no gap to plan for.
 */
export function withoutBackedOffHealth(
  health: readonly SupplyHealth[],
  index: SearchBackoffIndex,
  now: number,
): SupplyHealth[] {
  const interestIds = [
    ...new Set(
      health.flatMap((entry) => (entry.interestId === undefined ? [] : [entry.interestId])),
    ),
  ];
  return health.filter((entry) =>
    entry.interestId === undefined
      ? interestIds.some(
          (interestId) => !isBackedOff({ interestId, pool: entry.pool }, index, now),
        )
      : !isBackedOff({ interestId: entry.interestId, pool: entry.pool }, index, now),
  );
}

/** Drops the waiting requests a backoff already holds back, so none is planned for. */
export function withoutBackedOffGaps(
  gaps: readonly PendingGap[],
  index: SearchBackoffIndex,
  now: number,
): PendingGap[] {
  return gaps.filter(
    (gap) =>
      gap.interestId === undefined ||
      !isBackedOff({ interestId: gap.interestId, pool: gap.pool }, index, now),
  );
}

/**
 * Records whose interest is gone, disabled, or no longer described as it was
 * when the wait was recorded. Such a wait was earned by a requirement that no
 * longer exists, so the round drops it before it reads or writes any backoff.
 */
export function currentSearchBackoff(
  records: readonly SearchBackoffRecord[],
  interests: readonly InterestSnapshotEntry[],
): SearchBackoffRecord[] {
  return records.filter((record) =>
    interests.some(
      (interest) => interest.id === record.interestId && interest.text === record.interestText,
    ),
  );
}

/**
 * Records what this round's searches earned. A pair that searched successfully
 * without gaining an effective candidate waits `maintenanceIntervalMinutes × 2ⁿ`
 * from the end of the round, capped at `maxSearchBackoffHours`; a pair that
 * gained one starts over at n = 0. A pair this round never searched keeps the
 * wait it already had, and a record only survives while its interest is still
 * enabled and still carries the description the wait was recorded for.
 */
export function updateSearchBackoff(input: {
  readonly previous: readonly SearchBackoffRecord[];
  readonly interests: readonly InterestSnapshotEntry[];
  readonly searched: SearchedPairs;
  /** Effective candidate counts before this round's searches, by pair key. */
  readonly before: ReadonlyMap<string, number>;
  /** The same counts after them. */
  readonly after: ReadonlyMap<string, number>;
  readonly config: SupplyExecutionConfig;
  readonly now: number;
}): SearchBackoffRecord[] {
  const records: SearchBackoffRecord[] = [];
  for (const interest of input.interests) {
    for (const pool of ['daily', 'long_term'] as const) {
      const key = searchBackoffKey({ interestId: interest.id, pool });
      const previous = input.previous.find(
        (record) => record.interestId === interest.id && record.pool === pool,
      );
      if (!input.searched.has(key)) {
        // No search this round, so the pair keeps the wait it already had.
        if (previous) records.push(previous);
        continue;
      }
      const gained = (input.after.get(key) ?? 0) > (input.before.get(key) ?? 0);
      if (gained) continue;
      const consecutive = (previous?.consecutiveLowYieldRounds ?? 0) + 1;
      records.push({
        interestId: interest.id,
        interestText: interest.text,
        pool,
        consecutiveLowYieldRounds: consecutive,
        nextAllowedAt: input.now + waitFor(consecutive, input.config),
      });
    }
  }
  return records;
}

/** The reported wait for every pair still waiting after this round's searches. */
export function searchBackoffIssues(
  records: readonly SearchBackoffRecord[],
  now: number,
): SupplyIssue[] {
  return records
    .filter((record) => record.nextAllowedAt > now)
    .map((record) => ({
      stage: 'search' as const,
      code: 'SEARCH_BACKOFF',
      subjectId: record.interestId,
      message: `The ${record.pool} pool is in search backoff after ${record.consecutiveLowYieldRounds} low-yield rounds; its next search may start at ${record.nextAllowedAt}.`,
    }));
}

/** Indexes saved records by the key a round looks a pair up with. */
export function indexSearchBackoff(
  records: readonly SearchBackoffRecord[],
): Map<string, SearchBackoffRecord> {
  return new Map(
    records.map((record) => [
      searchBackoffKey({ interestId: record.interestId, pool: record.pool }),
      record,
    ]),
  );
}

/** The configured wait for one run of `consecutive` low-yield rounds. */
function waitFor(consecutive: number, config: SupplyExecutionConfig): number {
  const exponential = config.maintenanceIntervalMinutes * 60 * 1_000 * 2 ** consecutive;
  return Math.min(exponential, config.maxSearchBackoffHours * HOUR_MS);
}

/** Reads one round's effective candidate counts per (interest, pool) pair. */
export function countInterestCandidates(
  evaluations: readonly { readonly interestHealth: readonly SupplyHealth[] }[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const evaluation of evaluations) {
    for (const health of evaluation.interestHealth) {
      if (health.interestId === undefined) continue;
      counts.set(
        searchBackoffKey({ interestId: health.interestId, pool: health.pool }),
        health.activeCandidates,
      );
    }
  }
  return counts;
}
