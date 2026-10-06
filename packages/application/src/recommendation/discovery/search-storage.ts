/*
 * Owns search history, query effect reads, and the supply checkpoint that has to
 * survive restarts. Query rows themselves belong to the query library; this
 * module records what actually ran, what it produced, and how long a source is
 * cooling down.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';

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

export interface SupplyCheckpoint {
  readonly lastFinishedAt?: number;
  readonly nextInterestId?: string;
}

export interface SearchStorage {
  recordSearch(input: SearchRecordInput): void;
  /** Searches newer than `since`, newest first. */
  listRecentSearches(input: { since: number }): readonly SearchRecord[];
  /** Marks a query as used now; failed searches still count as use. */
  touchQuery(input: { queryId: string; now: number }): void;
  readSourceCooldowns(): SourceCooldowns;
  writeSourceCooldowns(cooldowns: SourceCooldowns): void;
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
                ON CONFLICT (id) DO UPDATE SET source_cooldowns = excluded.source_cooldowns`,
        })
        .run([JSON.stringify(cooldowns)]);
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

const SourceCooldownsSchema = z.record(z.number().int().nonnegative());

interface SearchHistoryRow extends DatabaseRow {
  readonly query_id: string;
  readonly source: string;
  readonly search_scope: string;
  readonly outcome: string;
  readonly result_count: number | null;
  readonly new_item_count: number | null;
  readonly searched_at: number;
}
