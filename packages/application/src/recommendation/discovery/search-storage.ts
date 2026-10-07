/*
 * Owns search history, query effect reads, and the supply checkpoint that has to
 * survive restarts. Query rows themselves belong to the query library; this
 * module records what actually ran, what it produced, and how long a source is
 * cooling down.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import { CandidatePoolSchema } from '../candidates/candidate-contracts';
import { RawItemSchema, type RawItem } from '../sources/source-connector';

/** The scope one search actually used; kept as validated JSON. */
export const SearchScopeSchema = z
  .object({
    query: z.string().trim().min(1),
    limit: z.number().int().positive(),
    timeRange: z
      .object({
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SearchScope = z.infer<typeof SearchScopeSchema>;

export interface SearchRecordInput {
  readonly id: string;
  readonly queryId: string;
  readonly source: string;
  readonly scope: SearchScope;
  readonly outcome: 'success' | 'failed';
  /** Present only for a successful search. */
  readonly resultCount?: number;
  readonly newItemCount?: number;
  readonly now: number;
}

/** One completed search, as read back for planning. */
export interface SearchRecord {
  readonly queryId: string;
  readonly source: string;
  readonly scope: SearchScope;
  readonly outcome: 'success' | 'failed';
  readonly resultCount?: number;
  readonly newItemCount?: number;
  readonly searchedAt: number;
}

export interface SourceCooldowns {
  readonly [source: string]: number;
}

/** One (interest, pool) pair as search backoff identifies it. */
const SearchBackoffKeySchema = z
  .object({ interestId: z.string().trim().min(1), pool: CandidatePoolSchema })
  .strict();
type SearchBackoffKey = z.infer<typeof SearchBackoffKeySchema>;

/** How long one (interest, pool) pair must wait before its next search. */
export const SearchBackoffRecordSchema = SearchBackoffKeySchema.extend({
  /** The interest description the wait was earned for; an edit invalidates it. */
  interestText: z.string().trim().min(1),
  /** Low-yield rounds that ran back to back; zero is never stored. */
  consecutiveLowYieldRounds: z.number().int().positive(),
  nextAllowedAt: z.number().int().nonnegative(),
}).strict();
export type SearchBackoffRecord = z.infer<typeof SearchBackoffRecordSchema>;

/** Stable identity of one backoff record, usable as a Map key. */
export function searchBackoffKey(key: SearchBackoffKey): string {
  return `${key.interestId}\u0000${key.pool}`;
}

export interface SupplyCheckpoint {
  readonly lastFinishedAt?: number;
  readonly nextInterestId?: string;
}

export interface SearchStorage {
  recordSearch(input: SearchRecordInput): void;
  /**
   * Discoveries saved but not yet normalized, plus failed ones whose retry is
   * due. This is how a round resumes after an earlier process stopped.
   */
  listDueDiscoveries(input: {
    limit: number;
    now: number;
    maxAttempts: number;
  }): readonly DueDiscovery[];
  /** Marks a failed discovery as waiting until `retryAt`. */
  scheduleDiscoveryRetry(input: { resultId: string; retryAt: number; errorCode: string }): void;
  /** Searches newer than `since`, newest first. */
  listRecentSearches(input: { since: number }): readonly SearchRecord[];
  /** Marks a query as used now; failed searches still count as use. */
  touchQuery(input: { queryId: string; now: number }): void;
  readSourceCooldowns(): SourceCooldowns;
  writeSourceCooldowns(cooldowns: SourceCooldowns): void;
  /** Backoff records in interest order, then pool order; absent means no wait. */
  readSearchBackoff(): readonly SearchBackoffRecord[];
  writeSearchBackoff(records: readonly SearchBackoffRecord[]): void;
  readCheckpoint(): SupplyCheckpoint;
  writeCheckpoint(input: SupplyCheckpoint & { now: number }): void;
}

export function createSearchStorage(database: DatabaseConnection): SearchStorage {
  return {
    recordSearch(input) {
      database
        .prepare({
          sql: `INSERT INTO search_history
                  (id, query_id, source, search_scope, searched_at, outcome, result_count, new_item_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        })
        .run([
          input.id,
          input.queryId,
          input.source,
          JSON.stringify(input.scope),
          input.now,
          input.outcome,
          input.outcome === 'success' ? (input.resultCount ?? 0) : null,
          input.outcome === 'success' ? (input.newItemCount ?? 0) : null,
        ]);
    },

    listDueDiscoveries(input) {
      return database
        .prepare<DiscoveryRow>({
          sql: `SELECT id, source, external_id, url, title, description, author, published_at, raw_payload
                FROM search_results
                WHERE attempts < ?
                  AND (status = 'pending'
                       OR (status = 'failed' AND retry_at IS NOT NULL AND retry_at <= ?))
                ORDER BY first_seen_at, id
                LIMIT ?`,
        })
        .all([input.maxAttempts, input.now, input.limit])
        .map((row) => ({
          resultId: row.id,
          item: row.raw_payload ? RawItemSchema.parse(JSON.parse(row.raw_payload)) : {
            source: row.source,
            url: row.url,
            ...(row.external_id ? { externalId: row.external_id } : {}),
            ...(row.title ? { title: row.title } : {}),
            ...(row.description ? { text: row.description } : {}),
            ...(row.author ? { author: row.author } : {}),
            ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
          },
        }));
    },

    scheduleDiscoveryRetry(input) {
      database
        .prepare({
          sql: `UPDATE search_results
                SET status = 'failed', attempts = attempts + 1, retry_at = ?, last_error_code = ?
                WHERE id = ?`,
        })
        .run([input.retryAt, input.errorCode, input.resultId]);
    },

    listRecentSearches(input) {
      return database
        .prepare<SearchHistoryRow>({
          sql: `SELECT query_id, source, search_scope, outcome, result_count, new_item_count, searched_at
                FROM search_history WHERE searched_at >= ? ORDER BY searched_at DESC`,
        })
        .all([input.since])
        .flatMap((row) => {
          const scope = SearchScopeSchema.safeParse(JSON.parse(row.search_scope));
          if (!scope.success) return [];
          return [
            {
              queryId: row.query_id,
              source: row.source,
              scope: scope.data,
              outcome: row.outcome === 'failed' ? ('failed' as const) : ('success' as const),
              ...(row.result_count !== null ? { resultCount: row.result_count } : {}),
              ...(row.new_item_count !== null ? { newItemCount: row.new_item_count } : {}),
              searchedAt: row.searched_at,
            },
          ];
        });
    },

    touchQuery(input) {
      database
        .prepare({ sql: 'UPDATE search_queries SET last_used_at = ? WHERE id = ?' })
        .run([input.now, input.queryId]);
    },

    readSourceCooldowns() {
      const row = database
        .prepare<{ source_cooldowns: string }>({
          sql: 'SELECT source_cooldowns FROM candidate_supply_state WHERE id = 1',
        })
        .get();
      if (!row) return {};
      const parsed = SourceCooldownsSchema.safeParse(JSON.parse(row.source_cooldowns));
      return parsed.success ? parsed.data : {};
    },

    writeSourceCooldowns(cooldowns) {
      database
        .prepare({
          sql: `INSERT INTO candidate_supply_state (id, source_cooldowns) VALUES (1, ?)
                ON CONFLICT (id) DO UPDATE SET
                  source_cooldowns = excluded.source_cooldowns,
                  search_backoff = candidate_supply_state.search_backoff`,
        })
        .run([JSON.stringify(cooldowns)]);
    },

    readSearchBackoff() {
      const row = database
        .prepare<{ search_backoff: string }>({
          sql: 'SELECT search_backoff FROM candidate_supply_state WHERE id = 1',
        })
        .get();
      if (!row) return [];
      const parsed = SearchBackoffRecordsSchema.safeParse(JSON.parse(row.search_backoff));
      if (!parsed.success) return [];
      // Interest id first, then pool, so a reader sees a stable order.
      return [...parsed.data].sort(
        (left, right) =>
          left.interestId.localeCompare(right.interestId) ||
          left.pool.localeCompare(right.pool),
      );
    },

    writeSearchBackoff(records) {
      database
        .prepare({
          // The row may not exist yet, so the insert carries the other JSON
          // column's empty value; an existing row keeps whatever it holds.
          sql: `INSERT INTO candidate_supply_state (id, source_cooldowns, search_backoff)
                VALUES (1, '{}', ?)
                ON CONFLICT (id) DO UPDATE SET
                  search_backoff = excluded.search_backoff,
                  source_cooldowns = candidate_supply_state.source_cooldowns`,
        })
        .run([JSON.stringify(records)]);
    },

    readCheckpoint() {
      const row = database
        .prepare<{ last_finished_at: number | null; next_interest_id: string | null }>({
          sql: 'SELECT last_finished_at, next_interest_id FROM candidate_supply_state WHERE id = 1',
        })
        .get();
      return {
        ...(row?.last_finished_at !== null && row?.last_finished_at !== undefined
          ? { lastFinishedAt: row.last_finished_at }
          : {}),
        ...(row?.next_interest_id ? { nextInterestId: row.next_interest_id } : {}),
      };
    },

    writeCheckpoint(input) {
      database
        .prepare({
          sql: `INSERT INTO candidate_supply_state (id, last_finished_at, next_interest_id, source_cooldowns)
                VALUES (1, ?, ?, '{}')
                ON CONFLICT (id) DO UPDATE SET
                  last_finished_at = COALESCE(excluded.last_finished_at, candidate_supply_state.last_finished_at),
                  next_interest_id = excluded.next_interest_id`,
        })
        .run([input.lastFinishedAt ?? null, input.nextInterestId ?? null]);
    },
  };
}

/** One stored discovery a round still has to process. */
export interface DueDiscovery {
  readonly resultId: string;
  readonly item: RawItem;
}

interface DiscoveryRow extends DatabaseRow {
  readonly raw_payload: string | null;
  readonly id: string;
  readonly source: string;
  readonly external_id: string | null;
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly author: string | null;
  readonly published_at: number | null;
}

const SourceCooldownsSchema = z.record(z.number().int().nonnegative());

const SearchBackoffRecordsSchema = z.array(SearchBackoffRecordSchema);

interface SearchHistoryRow extends DatabaseRow {
  readonly query_id: string;
  readonly source: string;
  readonly search_scope: string;
  readonly outcome: string;
  readonly result_count: number | null;
  readonly new_item_count: number | null;
  readonly searched_at: number;
}
