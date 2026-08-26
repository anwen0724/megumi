/*
 * Owns durable Recommendation publication, queries, and user-controlled state.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import {
  DiscoveryHomeViewSchema,
  GetDiscoveryHomeRequestSchema,
  InterestViewSchema,
  RecommendationViewSchema,
  SearchRecommendationsRequestSchema,
  SearchRecommendationsResultSchema,
  type DiscoveryHomeMode,
  type DiscoveryHomeView,
  type RecommendationView,
  type SearchRecommendationsResult,
} from '../discovery-view';
import { LocalDateSchema } from '../daily-discovery/daily-discovery';
import {
  type Recommendation,
  RecommendationReferenceContentSchema,
  UpdateRecommendationStateRequestSchema,
  type RecommendationReferenceContent,
  type UpdateRecommendationStateRequest,
} from '../recommendations/recommendation';

export interface RecommendationSelectionSignal {
  readonly contentIdentity: string;
  readonly sourceName: string;
  readonly title: string;
  readonly reaction?: 'liked' | 'disliked';
}

export interface RecommendationPublicationWriter {
  /** Inserts a Recommendation inside the caller-owned publication transaction. */
  insertForPublication(recommendation: Recommendation): void;
}

export interface RecommendationRepositoryOperations {
  /** Lists durable selection signals used to avoid repetition and learn from feedback. */
  listRecommendationSelectionSignals(): readonly RecommendationSelectionSignal[];
  /** Reads the paginated Discovery Home projection. */
  readHome(query: ReadHomeQuery): DiscoveryHomeView;
  /** Searches persisted Recommendations. */
  searchRecommendations(query: {
    readonly query: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): SearchRecommendationsResult;
  /** Applies one user-controlled Recommendation state change atomically. */
  updateRecommendationState(command: RecommendationStateCommand): RecommendationView;
  /** Reads the reference content used to start a Recommendation conversation. */
  readRecommendationReference(recommendationId: string): RecommendationReferenceContent | undefined;
}

export interface RecommendationRepository {
  readonly operations: RecommendationRepositoryOperations;
  readonly publicationWriter: RecommendationPublicationWriter;
}

export interface ReadHomeQuery {
  readonly mode: DiscoveryHomeMode;
  readonly localDate: string;
  readonly cursor?: string;
  readonly limit?: number;
  readonly nextScheduledAt?: string;
}

export type RecommendationStateCommand = UpdateRecommendationStateRequest & { readonly now: string };

/** Creates the Recommendation persistence operations and transaction-scoped writer. */
export function createRecommendationRepository(database: DatabaseConnection): RecommendationRepository {
  return {
    operations: {
      listRecommendationSelectionSignals: () => listRecommendationSelectionSignals(database),
      readHome: (query) => readHome(database, query),
      searchRecommendations: (query) => searchRecommendations(database, query),
      updateRecommendationState: (command) => database.transaction({
        operation: () => updateRecommendationState(database, command),
      }),
      readRecommendationReference: (recommendationId) => (
        readRecommendationReference(database, recommendationId)
      ),
    },
    publicationWriter: {
      insertForPublication: (recommendation) => insertRecommendation(database, recommendation),
    },
  };
}

function listRecommendationSelectionSignals(
  database: DatabaseConnection,
): readonly RecommendationSelectionSignal[] {
  return database.prepare<RecommendationSelectionSignalRow>({ sql: `
    SELECT content_identity, source_name, title, reaction
    FROM discovery_recommendations
    ORDER BY published_at, position, recommendation_id
  ` }).all().map((row) => ({
    contentIdentity: row.content_identity,
    sourceName: row.source_name,
    title: row.title,
    ...(row.reaction === 'liked' || row.reaction === 'disliked' ? { reaction: row.reaction } : {}),
  }));
}

/** Reads the stable renderer-facing Home projection from published Recommendations. */
function readHome(database: DatabaseConnection, query: ReadHomeQuery): DiscoveryHomeView {
  const request = GetDiscoveryHomeRequestSchema.parse({
    mode: query.mode,
    ...(query.cursor ? { cursor: query.cursor } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  });
  const localDate = LocalDateSchema.parse(query.localDate);
  const limit = request.limit ?? 30;
  const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
  const modeFilter = request.mode === 'favorites'
    ? 'AND r.favorite_at IS NOT NULL'
    : request.mode === 'watch_later'
      ? 'AND r.watch_later_at IS NOT NULL'
      : '';
  const cursorFilter = cursor ? `AND (
    b.local_date < ? OR
    (b.local_date = ? AND r.position > ?) OR
    (b.local_date = ? AND r.position = ? AND r.recommendation_id > ?)
  )` : '';
  const parameters = cursor
    ? [cursor.localDate, cursor.localDate, cursor.position, cursor.localDate, cursor.position, cursor.recommendationId, limit + 1]
    : [limit + 1];
  const rows = database.prepare<RecommendationRow>({ sql: `
    SELECT r.*, b.local_date
    FROM discovery_recommendations r
    JOIN discovery_batches b ON b.batch_id = r.batch_id
    WHERE b.status = 'published' AND r.hidden_at IS NULL
      ${modeFilter}
      ${cursorFilter}
    ORDER BY b.local_date DESC, r.position ASC, r.recommendation_id ASC
    LIMIT ?
  ` }).all(parameters);
  const page = rows.slice(0, limit);
  const recommendations = page.map(recommendationViewFromRow);
  const days = [...groupByDate(recommendations)].map(([date, items]) => ({
    localDate: date,
    recommendations: items,
  }));
  const counts = database.prepare<CountRow>({ sql: `
    SELECT
      SUM(CASE WHEN hidden_at IS NULL AND favorite_at IS NOT NULL THEN 1 ELSE 0 END) AS favorite_count,
      SUM(CASE WHEN hidden_at IS NULL AND watch_later_at IS NOT NULL THEN 1 ELSE 0 END) AS watch_later_count
    FROM discovery_recommendations
  ` }).get();
  const interests = database.prepare<InterestViewRow>({ sql: `
    SELECT interest_id, description, status, created_from, user_managed_at, created_at, updated_at
    FROM discovery_interests
    WHERE status IN ('active', 'paused')
    ORDER BY created_at, interest_id
  ` }).all().map(interestViewFromRow);
  const last = page.at(-1);
  return DiscoveryHomeViewSchema.parse({
    mode: request.mode,
    today: todayView(database, localDate),
    days,
    interests,
    favoriteCount: counts?.favorite_count ?? 0,
    watchLaterCount: counts?.watch_later_count ?? 0,
    ...(query.nextScheduledAt ? { nextScheduledAt: query.nextScheduledAt } : {}),
    ...(rows.length > limit && last ? { nextCursor: encodeCursor(last) } : {}),
  });
}

/** Searches persisted visible Recommendations with stable cursor pagination. */
function searchRecommendations(
  database: DatabaseConnection,
  input: { readonly query: string; readonly cursor?: string; readonly limit?: number },
): SearchRecommendationsResult {
  const request = SearchRecommendationsRequestSchema.parse(input);
  const limit = request.limit ?? 30;
  const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
  const cursorFilter = cursor ? `AND (
    b.local_date < ? OR
    (b.local_date = ? AND r.position > ?) OR
    (b.local_date = ? AND r.position = ? AND r.recommendation_id > ?)
  )` : '';
  const pattern = `%${escapeLike(request.query)}%`;
  const parameters: Array<string | number> = [pattern, pattern, pattern, pattern, pattern];
  if (cursor) parameters.push(
    cursor.localDate, cursor.localDate, cursor.position,
    cursor.localDate, cursor.position, cursor.recommendationId,
  );
  parameters.push(limit + 1);
  const rows = database.prepare<RecommendationRow>({ sql: `
    SELECT r.*, b.local_date
    FROM discovery_recommendations r
    JOIN discovery_batches b ON b.batch_id = r.batch_id
    WHERE b.status = 'published' AND r.hidden_at IS NULL
      AND (
        r.title LIKE ? ESCAPE '\\' OR COALESCE(r.author, '') LIKE ? ESCAPE '\\' OR
        r.source_name LIKE ? ESCAPE '\\' OR COALESCE(r.description, '') LIKE ? ESCAPE '\\' OR
        r.recommendation_reason LIKE ? ESCAPE '\\'
      )
      ${cursorFilter}
    ORDER BY b.local_date DESC, r.position ASC, r.recommendation_id ASC
    LIMIT ?
  ` }).all(parameters);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return SearchRecommendationsResultSchema.parse({
    query: request.query,
    recommendations: page.map(recommendationViewFromRow),
    ...(rows.length > limit && last ? { nextCursor: encodeCursor(last) } : {}),
  });
}

/** Applies one validated Recommendation action and returns the updated projection. */
function updateRecommendationState(
  database: DatabaseConnection,
  input: RecommendationStateCommand,
): RecommendationView {
  const { now: _now, ...requestValue } = input;
  const request = UpdateRecommendationStateRequestSchema.parse(requestValue);
  const now = parseTimestamp(input.now);
  switch (request.action) {
    case 'opened':
      database.prepare({ sql: `
        UPDATE discovery_recommendations
        SET first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ?, state_updated_at = ?
        WHERE recommendation_id = ?
      ` }).run([now, now, now, request.recommendationId]);
      break;
    case 'set_reaction':
      database.prepare({ sql: `
        UPDATE discovery_recommendations SET reaction = ?, state_updated_at = ? WHERE recommendation_id = ?
      ` }).run([request.reaction, now, request.recommendationId]);
      break;
    case 'set_hidden':
      database.prepare({ sql: `
        UPDATE discovery_recommendations SET hidden_at = ?, state_updated_at = ? WHERE recommendation_id = ?
      ` }).run([request.hidden ? now : null, now, request.recommendationId]);
      break;
    case 'set_favorite':
      database.prepare({ sql: `
        UPDATE discovery_recommendations SET favorite_at = ?, state_updated_at = ? WHERE recommendation_id = ?
      ` }).run([request.favorite ? now : null, now, request.recommendationId]);
      break;
    case 'set_watch_later':
      database.prepare({ sql: `
        UPDATE discovery_recommendations SET watch_later_at = ?, state_updated_at = ? WHERE recommendation_id = ?
      ` }).run([request.watchLater ? now : null, now, request.recommendationId]);
      break;
    default:
      assertNever(request);
  }
  const row = readRecommendation(database, request.recommendationId);
  if (!row) throw new Error(`Recommendation not found: ${request.recommendationId}.`);
  return recommendationViewFromRow(row);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Recommendation action: ${JSON.stringify(value)}`);
}

function todayView(database: DatabaseConnection, localDate: string) {
  const batch = database.prepare<BatchViewRow>({
    sql: 'SELECT * FROM discovery_batches WHERE local_date = ?',
  }).get([localDate]);
  if (!batch) return { localDate, status: 'not_generated' as const, resultCount: 0 };
  return {
    localDate,
    status: batch.status,
    batchId: batch.batch_id,
    executionId: batch.execution_id,
    targetCount: batch.target_count,
    resultCount: batch.result_count,
    ...(batch.failure_code ? {
      failure: { code: batch.failure_code, message: batch.failure_message ?? '', retryable: true },
    } : {}),
    ...(batch.published_at ? { publishedAt: batch.published_at } : {}),
  };
}

function readRecommendation(database: DatabaseConnection, recommendationId: string) {
  return database.prepare<RecommendationRow>({ sql: `
    SELECT r.*, b.local_date
    FROM discovery_recommendations r
    JOIN discovery_batches b ON b.batch_id = r.batch_id
    WHERE r.recommendation_id = ?
  ` }).get([recommendationId]);
}

/** Reads one currently published, visible Recommendation for a new conversation. */
function readRecommendationReference(
  database: DatabaseConnection,
  recommendationId: string,
): RecommendationReferenceContent | undefined {
  const row = database.prepare<RecommendationRow>({ sql: `
    SELECT r.*, b.local_date
    FROM discovery_recommendations r
    JOIN discovery_batches b ON b.batch_id = r.batch_id
    WHERE r.recommendation_id = ?
      AND b.status = 'published'
      AND r.hidden_at IS NULL
  ` }).get([recommendationId]);
  return row ? RecommendationReferenceContentSchema.parse({
    type: 'recommendation_reference',
    recommendationId: row.recommendation_id,
    sourceName: row.source_name,
    canonicalUrl: row.canonical_url,
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.content_published_at ? { publishedAt: row.content_published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    recommendationReason: row.recommendation_reason,
  }) : undefined;
}

function insertRecommendation(database: DatabaseConnection, item: Recommendation): void {
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position,
      source_id, source_name, canonical_url, title, content_type,
      source_content_id, author, content_published_at, description, cover_url,
      recommendation_reason, reaction, hidden_at, favorite_at, watch_later_at,
      first_opened_at, last_opened_at, published_at, state_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    item.recommendationId,
    item.batchId,
    item.contentIdentity,
    item.position,
    item.sourceId,
    item.sourceName,
    item.canonicalUrl,
    item.title,
    item.contentType,
    item.sourceContentId ?? null,
    item.author ?? null,
    item.contentPublishedAt ?? null,
    item.description ?? null,
    item.coverUrl ?? null,
    item.recommendationReason,
    item.reaction ?? null,
    item.hiddenAt ?? null,
    item.favoriteAt ?? null,
    item.watchLaterAt ?? null,
    item.firstOpenedAt ?? null,
    item.lastOpenedAt ?? null,
    item.publishedAt,
    item.stateUpdatedAt ?? null,
  ]);
}

function recommendationViewFromRow(row: RecommendationRow): RecommendationView {
  return RecommendationViewSchema.parse({
    recommendationId: row.recommendation_id,
    batchId: row.batch_id,
    localDate: row.local_date,
    position: row.position,
    sourceId: row.source_id,
    sourceName: row.source_name,
    canonicalUrl: row.canonical_url,
    contentType: row.content_type,
    ...(row.source_content_id ? { sourceContentId: row.source_content_id } : {}),
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.content_published_at ? { contentPublishedAt: row.content_published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    recommendationReason: row.recommendation_reason,
    ...(row.reaction ? { reaction: row.reaction } : {}),
    hidden: row.hidden_at !== null,
    favorite: row.favorite_at !== null,
    watchLater: row.watch_later_at !== null,
    ...(row.first_opened_at ? { firstOpenedAt: row.first_opened_at } : {}),
    ...(row.last_opened_at ? { lastOpenedAt: row.last_opened_at } : {}),
    publishedAt: row.published_at,
  });
}

function interestViewFromRow(row: InterestViewRow) {
  return InterestViewSchema.parse({
    interestId: row.interest_id,
    description: row.description,
    status: row.status,
    createdFrom: row.created_from,
    ...(row.user_managed_at ? { userManagedAt: row.user_managed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function groupByDate(recommendations: readonly RecommendationView[]) {
  const groups = new Map<string, RecommendationView[]>();
  for (const recommendation of recommendations) {
    const group = groups.get(recommendation.localDate) ?? [];
    group.push(recommendation);
    groups.set(recommendation.localDate, group);
  }
  return groups;
}

function encodeCursor(row: Pick<RecommendationRow, 'local_date' | 'position' | 'recommendation_id'>): string {
  return Buffer.from(JSON.stringify({
    localDate: row.local_date,
    position: row.position,
    recommendationId: row.recommendation_id,
  }), 'utf8').toString('base64url');
}

function decodeCursor(value: string): { localDate: string; position: number; recommendationId: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!isRecord(parsed) || typeof parsed.localDate !== 'string'
      || !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.localDate)
      || !Number.isInteger(parsed.position) || (parsed.position as number) < 0
      || typeof parsed.recommendationId !== 'string' || !parsed.recommendationId) {
      throw new Error('invalid');
    }
    return parsed as { localDate: string; position: number; recommendationId: string };
  } catch {
    throw new Error('Invalid Discovery pagination cursor.');
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('Expected an ISO timestamp.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type RecommendationRow = DatabaseRow & {
  recommendation_id: string; batch_id: string; local_date: string; content_identity: string;
  position: number; source_id: string; source_name: string; canonical_url: string;
  content_type: string; source_content_id: string | null; title: string; author: string | null;
  content_published_at: string | null; description: string | null; cover_url: string | null;
  recommendation_reason: string; reaction: string | null; hidden_at: string | null;
  favorite_at: string | null; watch_later_at: string | null; first_opened_at: string | null;
  last_opened_at: string | null; published_at: string;
};

type BatchViewRow = DatabaseRow & {
  batch_id: string; status: 'running' | 'published' | 'failed'; execution_id: string;
  target_count: number; result_count: number; failure_code: string | null;
  failure_message: string | null; published_at: string | null;
};

type CountRow = DatabaseRow & { favorite_count: number | null; watch_later_count: number | null };
type RecommendationSelectionSignalRow = DatabaseRow & {
  content_identity: string;
  source_name: string;
  title: string;
  reaction: string | null;
};
type InterestViewRow = DatabaseRow & {
  interest_id: string; description: string; status: string; created_from: string;
  user_managed_at: string | null; created_at: string; updated_at: string;
};
