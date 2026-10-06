/*
 * Executes searches for interests. `executeInterestSearch` is the documented
 * fallback path used when planning is unavailable; `executePlannedSearch` runs
 * one validated plan item with history, cooldown, and budget rules applied.
 */
import type { DatabaseConnection } from '../../storage/index';
import type { RawItem, SourceConnector } from '../sources/source-connector';
import { normalizeContentUrl } from '../content/normalize-content';
import type { ExecutionBudget } from '../supply/execution-budget';
import type { SearchStorage } from './search-storage';

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface InterestSearchInput {
  readonly interestId: string;
  readonly interestText: string;
  readonly limit: number;
  readonly timeRange?: { readonly from?: number; readonly to?: number };
  readonly now: number;
  readonly signal?: AbortSignal;
}

export type InterestSearchResult =
  | { status: 'success'; queryId: string; query: string; items: readonly StoredDiscovery[] }
  | { status: 'failed'; code: string; message: string; retryable: boolean };

/** One stored discovery together with the row later stages update. */
export interface StoredDiscovery {
  readonly resultId: string;
  readonly item: RawItem;
}

export interface InterestSearchDependencies {
  readonly database: DatabaseConnection;
  readonly source: SourceConnector;
  readonly newQueryId: () => string;
  readonly newResultId: () => string;
}

/** One plan item after the planner validated it. */
export interface PlannedSearch {
  readonly interestId: string;
  readonly source: string;
  readonly limit: number;
  readonly queryId?: string;
  readonly query?: string;
  readonly category?: string;
  readonly timeRange?: { readonly from?: number; readonly to?: number };
}

export interface PlannedSearchDependencies extends InterestSearchDependencies {
  readonly storage: SearchStorage;
  readonly budget: ExecutionBudget;
  readonly newHistoryId: () => string;
  /** Same source, query, and equivalent window are not repeated inside this window. */
  readonly reuseIntervalMs: number;
  /** Cooldown applied after the source throttles a request. */
  readonly cooldownMs: number;
}

export type PlannedSearchOutcome =
  | {
      status: 'success';
      queryId: string;
      resultCount: number;
      newItemCount: number;
      items: readonly StoredDiscovery[];
    }
  | { status: 'skipped'; reason: 'recent_duplicate' | 'source_cooling' | 'budget' }
  | { status: 'failed'; code: string; message: string; retryable: boolean };

/**
 * Resolves the query to use, calls the source, and stores one discovery row per
 * result. Discoveries keep their platform URL normalized so the same content
 * found twice maps onto one row.
 */
export async function executeInterestSearch(
  dependencies: InterestSearchDependencies,
  input: InterestSearchInput,
): Promise<InterestSearchResult> {
  const query = resolveQuery(dependencies, {
    interestId: input.interestId,
    fallbackQuery: input.interestText,
    now: input.now,
  });
  const searched = await callSource(dependencies.source, {
    query: query.text,
    limit: input.limit,
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (searched.status === 'failed') return searched;

  return {
    status: 'success',
    queryId: query.id,
    query: query.text,
    items: storeDiscovered(dependencies, searched.items, input.now),
  };
}

/**
 * Runs one planned search. A source already cooling down, a window searched
 * inside the reuse interval, or an exhausted budget stops the item before any
 * external request; every actual attempt is charged and recorded.
 */
export async function executePlannedSearch(
  dependencies: PlannedSearchDependencies,
  input: PlannedSearch & { readonly now: number; readonly signal?: AbortSignal },
): Promise<PlannedSearchOutcome> {
  const cooldowns = dependencies.storage.readSourceCooldowns();
  const until = cooldowns[input.source];
  if (until !== undefined && until > input.now) return { status: 'skipped', reason: 'source_cooling' };

  const query = resolveQuery(dependencies, {
    interestId: input.interestId,
    ...(input.queryId ? { queryId: input.queryId } : {}),
    ...(input.query ? { query: input.query } : {}),
    ...(input.category ? { category: input.category } : {}),
    now: input.now,
  });

  const recent = dependencies.storage.listRecentSearches({
    since: input.now - dependencies.reuseIntervalMs,
  });
  if (
    recent.some(
      (record) =>
        record.source === input.source &&
        record.scope.query === query.text &&
        sameWindow(record.scope.timeRange, input.timeRange),
    )
  ) {
    return { status: 'skipped', reason: 'recent_duplicate' };
  }

  if (!dependencies.budget.reserve('searchCalls')) return { status: 'skipped', reason: 'budget' };

  const searched = await callSource(dependencies.source, {
    query: query.text,
    limit: input.limit,
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });

  if (searched.status === 'failed') {
    recordHistory(dependencies, {
      queryId: query.id,
      source: input.source,
      scope: { query: query.text, limit: input.limit, ...(input.timeRange ? { timeRange: input.timeRange } : {}) },
      outcome: 'failed',
      now: input.now,
    });
    dependencies.storage.touchQuery({ queryId: query.id, now: input.now });
    if (searched.code === 'rate_limited') {
      dependencies.storage.writeSourceCooldowns({
        ...cooldowns,
        [input.source]: input.now + dependencies.cooldownMs,
      });
    }
    return searched;
  }

  const stored = storeDiscovered(dependencies, searched.items, input.now);
  recordHistory(dependencies, {
    queryId: query.id,
    source: input.source,
    scope: { query: query.text, limit: input.limit, ...(input.timeRange ? { timeRange: input.timeRange } : {}) },
    outcome: 'success',
    resultCount: searched.items.length,
    newItemCount: stored.filter((entry) => entry.created).length,
    now: input.now,
  });
  dependencies.storage.touchQuery({ queryId: query.id, now: input.now });

  return {
    status: 'success',
    queryId: query.id,
    resultCount: searched.items.length,
    newItemCount: stored.filter((entry) => entry.created).length,
    items: stored,
  };
}

interface ResolvedQuery {
  readonly id: string;
  readonly text: string;
}

/** Picks the query to run: an explicit id, a new expression, or the interest text. */
function resolveQuery(
  dependencies: InterestSearchDependencies,
  input: {
    readonly interestId: string;
    readonly queryId?: string;
    readonly query?: string;
    readonly category?: string;
    readonly fallbackQuery?: string;
    readonly now: number;
  },
): ResolvedQuery {
  if (input.queryId) {
    const stored = dependencies.database
      .prepare<{ id: string; query: string }>({
        sql: "SELECT id, query FROM search_queries WHERE id = ? AND status = 'active'",
      })
      .get([input.queryId]);
    if (stored) return { id: stored.id, text: stored.query };
  }

  if (input.query) {
    const existing = dependencies.database
      .prepare<{ id: string; query: string }>({
        sql: "SELECT id, query FROM search_queries WHERE interest_id = ? AND query = ? AND status = 'active'",
      })
      .get([input.interestId, input.query]);
    if (existing) return { id: existing.id, text: existing.query };

    const id = dependencies.newQueryId();
    dependencies.database
      .prepare({
        sql: `INSERT INTO search_queries (id, interest_id, query, category, origin, status, created_at)
              VALUES (?, ?, ?, ?, 'ai', 'active', ?)`,
      })
      .run([id, input.interestId, input.query, input.category ?? 'core', input.now]);
    return { id, text: input.query };
  }

  const active = dependencies.database
    .prepare<{ id: string; query: string }>({
      sql: "SELECT id, query FROM search_queries WHERE interest_id = ? AND status = 'active' ORDER BY created_at, id LIMIT 1",
    })
    .get([input.interestId]);
  if (active) return { id: active.id, text: active.query };

  const id = dependencies.newQueryId();
  const text = (input.fallbackQuery ?? '').trim();
  dependencies.database
    .prepare({
      sql: `INSERT INTO search_queries (id, interest_id, query, category, origin, status, created_at)
            VALUES (?, ?, ?, 'core', 'interest', 'active', ?)`,
    })
    .run([id, input.interestId, text, input.now]);
  return { id, text };
}

async function callSource(
  source: SourceConnector,
  request: {
    readonly query: string;
    readonly limit: number;
    readonly timeRange?: { readonly from?: number; readonly to?: number };
    readonly signal?: AbortSignal;
  },
): Promise<
  | { status: 'success'; items: readonly RawItem[] }
  | { status: 'failed'; code: string; message: string; retryable: boolean }
> {
  const searched = await source.search(request);
  return searched.status === 'success'
    ? searched
    : {
        status: 'failed',
        code: searched.failure.code,
        message: searched.failure.message,
        retryable: searched.failure.retryable,
      };
}

/** Stores every discovery and reports which rows were created rather than refreshed. */
function storeDiscovered(
  dependencies: InterestSearchDependencies,
  items: readonly RawItem[],
  now: number,
): readonly (StoredDiscovery & { readonly created: boolean })[] {
  const stored: (StoredDiscovery & { created: boolean })[] = [];
  for (const item of items) {
    const url = normalizeContentUrl(item.url);
    if (!url) continue;
    const normalized: RawItem = { ...item, url };
    const outcome = storeDiscovery(dependencies, normalized, now);
    stored.push({ resultId: outcome.id, item: normalized, created: outcome.created });
  }
  return stored;
}

function recordHistory(
  dependencies: PlannedSearchDependencies,
  input: {
    readonly queryId: string;
    readonly source: string;
    readonly scope: Parameters<SearchStorage['recordSearch']>[0]['scope'];
    readonly outcome: 'success' | 'failed';
    readonly resultCount?: number;
    readonly newItemCount?: number;
    readonly now: number;
  },
): void {
  dependencies.storage.recordSearch({
    id: dependencies.newHistoryId(),
    queryId: input.queryId,
    source: input.source,
    scope: input.scope,
    outcome: input.outcome,
    ...(input.resultCount !== undefined ? { resultCount: input.resultCount } : {}),
    ...(input.newItemCount !== undefined ? { newItemCount: input.newItemCount } : {}),
    now: input.now,
  });
}

/** Stores one discovery, refreshing `last_seen_at` when it was found before. */
function storeDiscovery(
  dependencies: InterestSearchDependencies,
  item: RawItem,
  now: number,
): { readonly id: string; readonly created: boolean } {
  const existing = dependencies.database
    .prepare<{ id: string }>({
      sql: 'SELECT id FROM search_results WHERE source = ? AND url = ?',
    })
    .get([item.source, item.url]);
  if (existing) {
    dependencies.database
      .prepare({ sql: 'UPDATE search_results SET last_seen_at = ? WHERE id = ?' })
      .run([now, existing.id]);
    return { id: existing.id, created: false };
  }

  const id = dependencies.newResultId();
  dependencies.database
    .prepare({
      sql: `INSERT INTO search_results
              (id, source, external_id, url, title, description, author, published_at,
               status, attempts, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    })
    .run([
      id,
      item.source,
      item.externalId ?? null,
      item.url,
      item.title ?? null,
      item.text ?? null,
      item.author ?? null,
      item.publishedAt ?? null,
      now,
      now,
    ]);
  return { id, created: true };
}

/**
 * Compares two windows by day so a moving "last N days" window is not treated
 * as a new range just because the current time advanced by seconds.
 */
function sameWindow(
  left: { readonly from?: number; readonly to?: number } | undefined,
  right: { readonly from?: number; readonly to?: number } | undefined,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return dayFloor(left.from) === dayFloor(right.from) && dayFloor(left.to) === dayFloor(right.to);
}

function dayFloor(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.floor(value / DAY_MS) * DAY_MS;
}
