/*
 * Owns candidate qualifications and the interest matches they depend on.
 * Committing relations re-checks every interest inside the transaction, so a
 * match judged against an older description never reaches the pools.
 */
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import {
  CandidatePoolSchema,
  CandidateStatusSchema,
  InactiveReasonSchema,
  type Candidate,
  type CandidatePool,
  type InactiveReason,
} from './candidate-contracts';
import type { InterestRelation } from '../content/content-contracts';

/** One judged relation together with the description the task worked from. */
export interface MatchToCommit {
  readonly interestId: string;
  readonly expectedText: string;
  readonly relation: InterestRelation;
  readonly basis?: string;
}

export interface RelationCommitInput {
  readonly contentId: string;
  readonly matches: readonly MatchToCommit[];
  readonly pools: readonly { readonly pool: CandidatePool; readonly expiresAt?: number }[];
  readonly now: number;
}

export interface RelationCommitResult {
  /** Relations saved because their interest still matched the task input. */
  readonly committedInterestIds: readonly string[];
  /** Relations dropped because the interest changed, was disabled, or is gone. */
  readonly skippedInterestIds: readonly string[];
  /** Pools that received an active qualification in this commit. */
  readonly committedPools: readonly CandidatePool[];
}

export interface CandidateStorage {
  /**
   * Saves matches and pool qualifications in one transaction. A content gets a
   * pool relation only when at least one of its interests was still current.
   */
  commitRelations(input: RelationCommitInput): RelationCommitResult;
  /** Marks one pool relation inactive; content整理 removes the row later. */
  markInactive(input: {
    contentId: string;
    pool: CandidatePool;
    reason: InactiveReason;
    now: number;
  }): void;
  /** Deletes one confirmed-exited pool relation. The content itself is untouched. */
  removeRelation(input: { contentId: string; pool: CandidatePool }): void;
  /**
   * Copies the representative's relations onto a duplicate member. Equal text
   * means equal relations, so the member never pays for another judgement.
   */
  copyRelations(input: { fromContentId: string; toContentId: string; now: number }): void;
  listForContent(contentId: string): readonly Candidate[];
  /**
   * Content whose ready analysis still lacks a saved relation for at least one
   * enabled interest. Newest discoveries come first.
   */
  listContentsMissingMatches(input: { limit: number }): readonly string[];
  /**
   * Of the given contents, those whose ready analysis still lacks a relation for
   * an enabled interest. Callers that are about to delete content use this to
   * leave work that is merely unfinished alone.
   */
  filterPendingMatchContentIds(contentIds: readonly string[]): readonly string[];
  /**
   * Content whose ready analysis already carries a current positive relation but
   * that holds no active pool relation. The judgement exists; only the pool
   * relation was never committed, so this is unfinished work, not new work.
   */
  listMatchedContentsWithoutActivePool(input: {
    limit: number;
  }): readonly MatchedContentRow[];
}

/** The facts the pool rules need for content that only lacks a pool relation. */
export interface MatchedContentRow {
  readonly contentId: string;
  readonly publishedAt?: number;
  readonly longTermValue?: string;
}

export function createCandidateStorage(database: DatabaseConnection): CandidateStorage {
  return {
    commitRelations(input) {
      return database.transaction({
        operation: () => {
          const committedInterestIds: string[] = [];
          const skippedInterestIds: string[] = [];

          for (const match of input.matches) {
            const current = database
              .prepare<{ text: string; enabled: number }>({
                sql: 'SELECT text, enabled FROM interests WHERE id = ?',
              })
              .get([match.interestId]);
            if (!current || current.enabled !== 1 || current.text !== match.expectedText) {
              skippedInterestIds.push(match.interestId);
              continue;
            }
            database
              .prepare({
                sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, basis, matched_at)
                      VALUES (?, ?, ?, ?, ?)
                      ON CONFLICT (content_id, interest_id) DO UPDATE SET
                        relation = excluded.relation, basis = excluded.basis, matched_at = excluded.matched_at`,
              })
              .run([
                input.contentId,
                match.interestId,
                match.relation,
                match.basis ?? null,
                input.now,
              ]);
            committedInterestIds.push(match.interestId);
          }

          const committedPools: CandidatePool[] = [];
          // A pool relation needs at least one current positive relation. A
          // duplicate member may have inherited them from its representative.
          const qualifies =
            committedInterestIds.length > 0 ||
            database
              .prepare({
                sql: "SELECT 1 AS present FROM content_interest_matches WHERE content_id = ? AND relation IN ('direct','related') LIMIT 1",
              })
              .get([input.contentId]) !== undefined;
          if (qualifies) {
            for (const entry of input.pools) {
              database
                .prepare({
                  sql: `INSERT INTO recommendation_candidates (pool, content_id, status, inactive_reason, expires_at, created_at, updated_at)
                        VALUES (?, ?, 'active', NULL, ?, ?, ?)
                        ON CONFLICT (pool, content_id) DO UPDATE SET
                          status = 'active', inactive_reason = NULL,
                          expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
                })
                .run([entry.pool, input.contentId, entry.expiresAt ?? null, input.now, input.now]);
              committedPools.push(entry.pool);
            }
          }

          return { committedInterestIds, skippedInterestIds, committedPools };
        },
      });
    },

    markInactive(input) {
      database
        .prepare({
          sql: `UPDATE recommendation_candidates SET status = 'inactive', inactive_reason = ?, updated_at = ?
                WHERE content_id = ? AND pool = ?`,
        })
        .run([input.reason, input.now, input.contentId, input.pool]);
    },

    removeRelation(input) {
      database
        .prepare({
          sql: 'DELETE FROM recommendation_candidates WHERE content_id = ? AND pool = ?',
        })
        .run([input.contentId, input.pool]);
    },

    copyRelations(input) {
      database
        .prepare({
          sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, basis, matched_at)
                SELECT ?, interest_id, relation, basis, ? FROM content_interest_matches WHERE content_id = ?
                ON CONFLICT (content_id, interest_id) DO UPDATE SET
                  relation = excluded.relation, basis = excluded.basis, matched_at = excluded.matched_at`,
        })
        .run([input.toContentId, input.now, input.fromContentId]);
    },

    listContentsMissingMatches(input) {
      return database
        .prepare<{ id: string }>({
          sql: `SELECT c.id FROM contents c
                JOIN content_analysis ca ON ca.content_id = c.id AND ca.status = 'ready'
                WHERE EXISTS (
                  SELECT 1 FROM interests i
                  WHERE i.enabled = 1 AND NOT EXISTS (
                    SELECT 1 FROM content_interest_matches m
                    WHERE m.content_id = c.id AND m.interest_id = i.id
                  )
                )
                ORDER BY c.created_at DESC, c.id
                LIMIT ?`,
        })
        .all([input.limit])
        .map((row) => row.id);
    },

    filterPendingMatchContentIds(contentIds) {
      if (contentIds.length === 0) return [];
      const placeholders = contentIds.map(() => '?').join(', ');
      return database
        .prepare<{ id: string }>({
          sql: `SELECT c.id FROM contents c
                JOIN content_analysis ca ON ca.content_id = c.id AND ca.status = 'ready'
                WHERE c.id IN (${placeholders})
                  AND EXISTS (
                    SELECT 1 FROM interests i
                    WHERE i.enabled = 1 AND NOT EXISTS (
                      SELECT 1 FROM content_interest_matches m
                      WHERE m.content_id = c.id AND m.interest_id = i.id
                    )
                  )`,
        })
        .all([...contentIds])
        .map((row) => row.id);
    },

    listMatchedContentsWithoutActivePool(input) {
      return database
        .prepare<
          DatabaseRow & { content_id: string; published_at: number | null; long_term_value: string | null }
        >({
          sql: `SELECT c.id AS content_id, c.published_at, ca.long_term_value
                FROM contents c
                JOIN content_analysis ca ON ca.content_id = c.id AND ca.status = 'ready'
                WHERE EXISTS (
                  SELECT 1 FROM content_interest_matches m
                  JOIN interests i ON i.id = m.interest_id AND i.enabled = 1
                  WHERE m.content_id = c.id AND m.relation IN ('direct','related')
                )
                  AND NOT EXISTS (
                    SELECT 1 FROM recommendation_candidates rc
                    WHERE rc.content_id = c.id AND rc.status = 'active'
                  )
                ORDER BY c.created_at, c.id
                LIMIT ?`,
        })
        .all([input.limit])
        .map((row) => ({
          contentId: row.content_id,
          ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
          ...(row.long_term_value !== null ? { longTermValue: row.long_term_value } : {}),
        }));
    },

    listForContent(contentId) {      return database
        .prepare<CandidateRow>({
          sql: `SELECT pool, content_id, status, inactive_reason, expires_at, created_at, updated_at
                FROM recommendation_candidates WHERE content_id = ? ORDER BY pool`,
        })
        .all([contentId])
        .map(toCandidate);
    },
  };
}

interface CandidateRow extends DatabaseRow {
  readonly pool: string;
  readonly content_id: string;
  readonly status: string;
  readonly inactive_reason: string | null;
  readonly expires_at: number | null;
  readonly created_at: number;
  readonly updated_at: number;
}

function toCandidate(row: CandidateRow): Candidate {
  return {
    pool: CandidatePoolSchema.parse(row.pool),
    contentId: row.content_id,
    status: CandidateStatusSchema.parse(row.status),
    ...(row.inactive_reason
      ? { inactiveReason: InactiveReasonSchema.parse(row.inactive_reason) }
      : {}),
    ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
