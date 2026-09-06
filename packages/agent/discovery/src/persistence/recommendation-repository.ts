/*
 * Owns Recommendation's immutable publication aggregate, mutable user state,
 * and revision-based Preference Learning handoff.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  LocalDateSchema,
  RecommendationCollectionSchema,
  RecommendationContentSchema,
  RecommendationSchema,
  RecommendationSelectionBasisSchema,
  RecommendationStateSchema,
  UpdateRecommendationStateRequestSchema,
  type Recommendation,
  type RecommendationCollection,
  type RecommendationContent,
  type RecommendationSelectionBasis,
  type RecommendationState,
  type UpdateRecommendationStateRequest,
} from '../recommendation/recommendation';

const TimestampSchema = z.string().datetime({ offset: true });
const PublishRequestSchema = z.object({
  localDate: LocalDateSchema,
  snapshotAt: TimestampSchema,
  publishedAt: TimestampSchema,
  items: z.array(z.object({
    candidateId: z.string().min(1),
    sourceName: z.string().trim().min(1),
    recommendationReason: z.string().trim().min(1).max(1000),
    selectionBasis: RecommendationSelectionBasisSchema,
  }).strict()).min(1),
}).strict();
const PendingReactionRequestSchema = z.object({
  limit: z.number().int().min(1).max(100),
}).strict();
const AcknowledgeReactionRequestSchema = z.object({
  recommendationId: z.string().min(1),
  expectedReactionRevision: z.number().int().positive(),
  learnedReaction: z.enum(['liked', 'disliked']).nullable(),
}).strict();

export interface PublishRecommendationItem {
  readonly candidateId: string;
  readonly sourceName: string;
  readonly recommendationReason: string;
  readonly selectionBasis: RecommendationSelectionBasis;
}

export interface PublishRecommendationsRequest {
  readonly localDate: string;
  readonly snapshotAt: string;
  readonly publishedAt: string;
  readonly items: readonly PublishRecommendationItem[];
}

export type PublishRecommendationsResult =
  | { readonly status: 'published'; readonly collection: RecommendationCollection }
  | { readonly status: 'already_published'; readonly collection: RecommendationCollection }
  | { readonly status: 'conflict'; readonly candidateIds: readonly string[] };

export type UpdateRecommendationStateResult =
  | { readonly status: 'updated' | 'unchanged'; readonly state: RecommendationState }
  | { readonly status: 'not_found' };

export interface PendingReactionChange {
  readonly recommendationId: string;
  readonly learnedReaction?: 'liked' | 'disliked';
  readonly learnedReactionRevision: number;
  readonly currentReaction?: 'liked' | 'disliked';
  readonly currentReactionRevision: number;
  readonly reactionChangedAt: string;
  readonly selectionBasis: RecommendationSelectionBasis;
  readonly content: RecommendationContent;
}

export interface RecommendationReferenceContent {
  readonly type: 'recommendation_reference';
  readonly recommendationId: string;
  readonly sourceName: string;
  readonly canonicalUrl: string;
  readonly title: string;
  readonly author?: string;
  readonly publishedAt?: string;
  readonly description?: string;
  readonly coverUrl?: string;
  readonly recommendationReason: string;
}

export interface RecommendationRepository {
  findRecommendationById(recommendationId: string): Recommendation | undefined;
  getRecommendationReference(recommendationId: string): RecommendationReferenceContent | undefined;
  getCollection(localDate: string, includeHidden?: boolean): RecommendationCollection | undefined;
  listRecommendationHistory(sincePublishedAt: string): readonly Recommendation[];
  listRecommendations(request: {
    readonly view: 'history' | 'favorites' | 'watch_later';
    readonly includeHidden: boolean;
    readonly offset: number;
    readonly limit: number;
  }): { readonly items: readonly Recommendation[]; readonly hasMore: boolean };
  searchRecommendations(request: {
    readonly query: string;
    readonly includeHidden: boolean;
    readonly offset: number;
    readonly limit: number;
  }): { readonly items: readonly Recommendation[]; readonly hasMore: boolean };
  countRecommendations(view: 'history' | 'favorites' | 'watch_later'): number;
  publish(request: PublishRecommendationsRequest): PublishRecommendationsResult;
  updateState(request: UpdateRecommendationStateRequest): UpdateRecommendationStateResult;
  listPendingReactionChanges(request: { readonly limit: number }): readonly PendingReactionChange[];
  acknowledgeReactionLearned(request: {
    readonly recommendationId: string;
    readonly expectedReactionRevision: number;
    readonly learnedReaction: 'liked' | 'disliked' | null;
  }): { readonly status: 'acknowledged' | 'revision_conflict' | 'not_found' };
}

export interface CreateRecommendationRepositoryOptions {
  readonly database: DatabaseConnection;
  readonly clock?: { readonly now: () => string };
  readonly ids?: { readonly createId: () => string };
}

/** Creates the sole persistence boundary for Recommendation business records. */
export function createRecommendationRepository(
  input: DatabaseConnection | CreateRecommendationRepositoryOptions,
): RecommendationRepository {
  const options = isOptions(input)
    ? input
    : { database: input };
  const clock = options.clock ?? { now: () => new Date().toISOString() };
  const ids = options.ids ?? { createId: () => randomUUID() };
  const { database } = options;
  return {
    findRecommendationById(recommendationId) {
      return findRecommendation(database, z.string().min(1).parse(recommendationId));
    },
    getRecommendationReference(recommendationId) {
      const item = findRecommendation(database, z.string().min(1).parse(recommendationId));
      if (!item) return undefined;
      return {
        type: 'recommendation_reference',
        recommendationId: item.id,
        sourceName: item.content.sourceName,
        canonicalUrl: item.content.canonicalUrl,
        title: item.content.title,
        ...(item.content.author ? { author: item.content.author } : {}),
        ...(item.content.contentPublishedAt ? { publishedAt: item.content.contentPublishedAt } : {}),
        ...(item.content.description ? { description: item.content.description } : {}),
        ...(item.content.coverUrl ? { coverUrl: item.content.coverUrl } : {}),
        recommendationReason: item.recommendationReason,
      };
    },
    getCollection(localDate, includeHidden = false) {
      return getCollection(database, LocalDateSchema.parse(localDate), includeHidden);
    },
    listRecommendationHistory(sincePublishedAt) {
      return database.prepare<RecommendationRow>({ sql: `
        ${recommendationSelect()}
        WHERE r.published_at >= ?
        ORDER BY r.published_at DESC, r.position, r.id
      ` }).all([TimestampSchema.parse(sincePublishedAt)]).map(recommendationFromRow);
    },
    listRecommendations(request) {
      const offset = nonnegativeInteger(request.offset, 'offset');
      const limit = boundedLimit(request.limit);
      const filter = request.view === 'favorites'
        ? 'AND s.favorite_at IS NOT NULL'
        : request.view === 'watch_later'
          ? 'AND s.watch_later_at IS NOT NULL'
          : '';
      const order = request.view === 'favorites'
        ? 's.favorite_at DESC, r.id'
        : request.view === 'watch_later'
          ? 's.watch_later_at DESC, r.id'
          : 'r.local_date DESC, r.position, r.id';
      const rows = database.prepare<RecommendationRow>({ sql: `
        ${recommendationSelect()}
        WHERE 1 = 1 ${request.includeHidden ? '' : 'AND s.hidden_at IS NULL'} ${filter}
        ORDER BY ${order} LIMIT ? OFFSET ?
      ` }).all([limit + 1, offset]);
      return { items: rows.slice(0, limit).map(recommendationFromRow), hasMore: rows.length > limit };
    },
    searchRecommendations(request) {
      const query = z.string().trim().min(1).max(200).parse(request.query);
      const offset = nonnegativeInteger(request.offset, 'offset');
      const limit = boundedLimit(request.limit);
      const pattern = `%${escapeLike(query)}%`;
      const rows = database.prepare<RecommendationRow>({ sql: `
        ${recommendationSelect()}
        WHERE (${request.includeHidden ? '1 = 1' : 's.hidden_at IS NULL'})
          AND (c.title LIKE ? ESCAPE '\\' OR COALESCE(c.author, '') LIKE ? ESCAPE '\\'
            OR c.source_name LIKE ? ESCAPE '\\' OR COALESCE(c.description, '') LIKE ? ESCAPE '\\'
            OR c.content_summary LIKE ? ESCAPE '\\')
        ORDER BY r.published_at DESC, r.position, r.id LIMIT ? OFFSET ?
      ` }).all([pattern, pattern, pattern, pattern, pattern, limit + 1, offset]);
      return { items: rows.slice(0, limit).map(recommendationFromRow), hasMore: rows.length > limit };
    },
    countRecommendations(view) {
      const filter = view === 'favorites'
        ? 's.favorite_at IS NOT NULL'
        : view === 'watch_later'
          ? 's.watch_later_at IS NOT NULL'
          : '1 = 1';
      return database.prepare<{ count: number }>({ sql: `
        SELECT COUNT(*) AS count FROM discovery_recommendations r
        JOIN discovery_recommendation_states s ON s.recommendation_id = r.id
        WHERE ${filter}
      ` }).get()?.count ?? 0;
    },
    publish(request) {
      const parsed = PublishRequestSchema.parse(request);
      const existing = getCollection(database, parsed.localDate, true);
      if (existing) return { status: 'already_published', collection: existing };
      const duplicateCandidateIds = duplicates(parsed.items.map(({ candidateId }) => candidateId));
      if (duplicateCandidateIds.length > 0) return { status: 'conflict', candidateIds: duplicateCandidateIds };
      try {
        return database.transaction({
          operation: () => publish(database, ids, parsed),
        });
      } catch (error) {
        if (error instanceof PublicationConflict) {
          return { status: 'conflict', candidateIds: error.candidateIds };
        }
        const authoritative = getCollection(database, parsed.localDate, true);
        if (authoritative) return { status: 'already_published', collection: authoritative };
        throw error;
      }
    },
    updateState(request) {
      return updateState(database, clock.now(), UpdateRecommendationStateRequestSchema.parse(request));
    },
    listPendingReactionChanges(request) {
      const { limit } = PendingReactionRequestSchema.parse(request);
      return listPendingReactionChanges(database, limit);
    },
    acknowledgeReactionLearned(request) {
      return acknowledgeReactionLearned(database, AcknowledgeReactionRequestSchema.parse(request));
    },
  };
}

function publish(
  database: DatabaseConnection,
  ids: { readonly createId: () => string },
  request: z.infer<typeof PublishRequestSchema>,
): Extract<PublishRecommendationsResult, { readonly status: 'published' }> {
  const existing = getCollection(database, request.localDate, true);
  if (existing) return { status: 'published', collection: existing };
  const candidates = request.items.map(({ candidateId }) => findPublishableCandidate(database, candidateId, request.snapshotAt));
  const unavailable = request.items
    .filter((_, index) => candidates[index] === undefined)
    .map(({ candidateId }) => candidateId);
  if (unavailable.length > 0) throw new PublicationConflict(unavailable);

  request.items.forEach((item, position) => {
    const candidate = candidates[position];
    if (!candidate) throw new PublicationConflict([item.candidateId]);
    const consumed = database.prepare({ sql: `
      UPDATE discovery_candidates SET status = 'consumed'
      WHERE id = ? AND status = 'available' AND expires_at > ?
        AND content_identity = ?
        AND NOT EXISTS (
          SELECT 1 FROM discovery_recommendations
          WHERE candidate_id = ? OR content_identity = ?
        )
    ` }).run([
      item.candidateId,
      request.snapshotAt,
      candidate.content_identity,
      item.candidateId,
      candidate.content_identity,
    ]);
    if (consumed.changes !== 1) throw new PublicationConflict([item.candidateId]);

    const recommendationId = ids.createId();
    const contentId = ids.createId();
    const stateId = ids.createId();
    database.prepare({ sql: `
      INSERT INTO discovery_recommendations (
        id, candidate_id, content_identity, local_date, position,
        recommendation_reason, selection_basis_json, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ` }).run([
      recommendationId,
      item.candidateId,
      candidate.content_identity,
      request.localDate,
      position,
      item.recommendationReason,
      JSON.stringify(item.selectionBasis),
      request.publishedAt,
    ]);
    database.prepare({ sql: `
      INSERT INTO discovery_recommendation_contents (
        id, recommendation_id, source_id, source_name, source_content_id,
        canonical_url, content_type, title, author, content_published_at,
        description, content_summary, content_excerpt, content_truncated, cover_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` }).run([
      contentId,
      recommendationId,
      candidate.source_id,
      item.sourceName,
      candidate.source_content_id,
      candidate.canonical_url,
      candidate.content_type,
      candidate.title,
      candidate.author,
      candidate.published_at,
      candidate.description,
      candidate.content_summary,
      candidate.content_excerpt,
      candidate.content_truncated,
      candidate.cover_url,
    ]);
    database.prepare({ sql: `
      INSERT INTO discovery_recommendation_states (
        id, recommendation_id, reaction_revision, learned_reaction_revision, updated_at
      ) VALUES (?, ?, 0, 0, ?)
    ` }).run([stateId, recommendationId, request.publishedAt]);
  });
  const collection = getCollection(database, request.localDate, true);
  if (!collection) throw new Error('Committed Recommendation collection could not be read.');
  return { status: 'published', collection };
}

function findPublishableCandidate(
  database: DatabaseConnection,
  candidateId: string,
  snapshotAt: string,
): CandidateRow | undefined {
  return database.prepare<CandidateRow>({ sql: `
    SELECT * FROM discovery_candidates
    WHERE id = ? AND status = 'available' AND expires_at > ?
  ` }).get([candidateId, snapshotAt]);
}

function findRecommendation(database: DatabaseConnection, recommendationId: string): Recommendation | undefined {
  const row = database.prepare<RecommendationRow>({ sql: `${recommendationSelect()} WHERE r.id = ?` })
    .get([recommendationId]);
  return row ? recommendationFromRow(row) : undefined;
}

function getCollection(
  database: DatabaseConnection,
  localDate: string,
  includeHidden: boolean,
): RecommendationCollection | undefined {
  const rows = database.prepare<RecommendationRow>({ sql: `
    ${recommendationSelect()}
    WHERE r.local_date = ? ${includeHidden ? '' : 'AND s.hidden_at IS NULL'}
    ORDER BY r.position, r.id
  ` }).all([localDate]);
  if (rows.length === 0) {
    const exists = database.prepare<{ found: number }>({
      sql: 'SELECT 1 AS found FROM discovery_recommendations WHERE local_date = ? LIMIT 1',
    }).get([localDate]);
    if (!exists) return undefined;
  }
  const allRows = rows.length > 0
    ? rows
    : database.prepare<RecommendationRow>({ sql: `${recommendationSelect()} WHERE r.local_date = ? ORDER BY r.position, r.id` })
      .all([localDate]);
  const first = allRows[0];
  if (!first) return undefined;
  return RecommendationCollectionSchema.parse({
    localDate,
    publishedAt: first.recommendation_published_at,
    items: rows.map(recommendationFromRow),
  });
}

function updateState(
  database: DatabaseConnection,
  rawNow: string,
  request: UpdateRecommendationStateRequest,
): UpdateRecommendationStateResult {
  const now = TimestampSchema.parse(rawNow);
  const current = findState(database, request.recommendationId);
  if (!current) return { status: 'not_found' };
  const changed = applyStateUpdate(database, now, current, request);
  const state = findState(database, request.recommendationId);
  if (!state) return { status: 'not_found' };
  return { status: changed ? 'updated' : 'unchanged', state };
}

function applyStateUpdate(
  database: DatabaseConnection,
  now: string,
  current: RecommendationState,
  request: UpdateRecommendationStateRequest,
): boolean {
  if (request.action === 'set_reaction') {
    const next = request.reaction ?? undefined;
    if (current.reaction === next) return false;
    database.prepare({ sql: `
      UPDATE discovery_recommendation_states
      SET reaction = ?, reaction_revision = reaction_revision + 1,
          reaction_changed_at = ?, updated_at = ?
      WHERE recommendation_id = ?
    ` }).run([request.reaction, now, now, request.recommendationId]);
    return true;
  }
  if (request.action === 'opened') {
    database.prepare({ sql: `
      UPDATE discovery_recommendation_states
      SET first_opened_at = COALESCE(first_opened_at, ?), last_opened_at = ?, updated_at = ?
      WHERE recommendation_id = ?
    ` }).run([now, now, now, request.recommendationId]);
    return true;
  }
  const stateColumn = request.action === 'set_hidden'
    ? 'hidden_at'
    : request.action === 'set_favorite'
      ? 'favorite_at'
      : 'watch_later_at';
  const enabled = request.action === 'set_hidden'
    ? request.hidden
    : request.action === 'set_favorite'
      ? request.favorite
      : request.watchLater;
  const currentValue = request.action === 'set_hidden'
    ? current.hiddenAt
    : request.action === 'set_favorite'
      ? current.favoriteAt
      : current.watchLaterAt;
  if (enabled === (currentValue !== undefined)) return false;
  database.prepare({ sql: `
    UPDATE discovery_recommendation_states SET ${stateColumn} = ?, updated_at = ?
    WHERE recommendation_id = ?
  ` }).run([enabled ? now : null, now, request.recommendationId]);
  return true;
}

function listPendingReactionChanges(database: DatabaseConnection, limit: number): readonly PendingReactionChange[] {
  return database.prepare<RecommendationRow>({ sql: `
    ${recommendationSelect()}
    WHERE s.reaction_revision > s.learned_reaction_revision
    ORDER BY s.reaction_changed_at, r.id LIMIT ?
  ` }).all([limit]).map((row) => ({
    recommendationId: row.recommendation_id,
    ...(reaction(row.learned_reaction) ? { learnedReaction: reaction(row.learned_reaction) } : {}),
    learnedReactionRevision: row.learned_reaction_revision,
    ...(reaction(row.reaction) ? { currentReaction: reaction(row.reaction) } : {}),
    currentReactionRevision: row.reaction_revision,
    reactionChangedAt: requireString(row.reaction_changed_at),
    selectionBasis: RecommendationSelectionBasisSchema.parse(JSON.parse(row.selection_basis_json)),
    content: contentFromRow(row),
  }));
}

function acknowledgeReactionLearned(
  database: DatabaseConnection,
  request: z.infer<typeof AcknowledgeReactionRequestSchema>,
): { readonly status: 'acknowledged' | 'revision_conflict' | 'not_found' } {
  const current = findState(database, request.recommendationId);
  if (!current) return { status: 'not_found' };
  if (current.reactionRevision !== request.expectedReactionRevision) return { status: 'revision_conflict' };
  const updated = database.prepare({ sql: `
    UPDATE discovery_recommendation_states
    SET learned_reaction = ?, learned_reaction_revision = ?
    WHERE recommendation_id = ? AND reaction_revision = ?
  ` }).run([
    request.learnedReaction,
    request.expectedReactionRevision,
    request.recommendationId,
    request.expectedReactionRevision,
  ]);
  return updated.changes === 1 ? { status: 'acknowledged' } : { status: 'revision_conflict' };
}

function findState(database: DatabaseConnection, recommendationId: string): RecommendationState | undefined {
  const row = database.prepare<StateRow>({
    sql: 'SELECT * FROM discovery_recommendation_states WHERE recommendation_id = ?',
  }).get([recommendationId]);
  return row ? stateFromRow(row) : undefined;
}

function recommendationSelect(): string {
  return `SELECT
    r.id AS recommendation_id, r.candidate_id, r.content_identity, r.local_date,
    r.position, r.recommendation_reason, r.selection_basis_json,
    r.published_at AS recommendation_published_at,
    c.id AS content_id, c.source_id, c.source_name, c.source_content_id,
    c.canonical_url, c.content_type, c.title, c.author, c.content_published_at,
    c.description, c.content_summary, c.content_excerpt, c.content_truncated, c.cover_url,
    s.id AS state_id, s.reaction, s.reaction_revision, s.reaction_sequence, s.reaction_changed_at,
    s.learned_reaction, s.learned_reaction_revision, s.favorite_at, s.watch_later_at,
    s.hidden_at, s.first_opened_at, s.last_opened_at, s.updated_at
  FROM discovery_recommendations r
  JOIN discovery_recommendation_contents c ON c.recommendation_id = r.id
  JOIN discovery_recommendation_states s ON s.recommendation_id = r.id`;
}

function recommendationFromRow(row: RecommendationRow): Recommendation {
  return RecommendationSchema.parse({
    id: row.recommendation_id,
    candidateId: row.candidate_id,
    contentIdentity: row.content_identity,
    localDate: row.local_date,
    position: row.position,
    recommendationReason: row.recommendation_reason,
    selectionBasis: JSON.parse(row.selection_basis_json),
    publishedAt: row.recommendation_published_at,
    content: contentFromRow(row),
    state: stateFromRow({
      id: row.state_id,
      recommendation_id: row.recommendation_id,
      reaction: row.reaction,
      reaction_revision: row.reaction_revision,
      reaction_sequence: row.reaction_sequence,
      reaction_changed_at: row.reaction_changed_at,
      learned_reaction: row.learned_reaction,
      learned_reaction_revision: row.learned_reaction_revision,
      favorite_at: row.favorite_at,
      watch_later_at: row.watch_later_at,
      hidden_at: row.hidden_at,
      first_opened_at: row.first_opened_at,
      last_opened_at: row.last_opened_at,
      updated_at: row.updated_at,
    }),
  });
}

function contentFromRow(row: RecommendationRow): RecommendationContent {
  return RecommendationContentSchema.parse({
    id: row.content_id,
    recommendationId: row.recommendation_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    ...(row.source_content_id ? { sourceContentId: row.source_content_id } : {}),
    canonicalUrl: row.canonical_url,
    contentType: row.content_type,
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.content_published_at ? { contentPublishedAt: row.content_published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    contentSummary: row.content_summary,
    ...(row.content_excerpt ? { contentExcerpt: row.content_excerpt } : {}),
    contentTruncated: row.content_truncated === 1,
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
  });
}

function stateFromRow(row: StateRow): RecommendationState {
  return RecommendationStateSchema.parse({
    id: row.id,
    recommendationId: row.recommendation_id,
    ...(reaction(row.reaction) ? { reaction: reaction(row.reaction) } : {}),
    reactionRevision: row.reaction_revision,
    reactionSequence: row.reaction_sequence,
    ...(row.reaction_changed_at ? { reactionChangedAt: row.reaction_changed_at } : {}),
    ...(reaction(row.learned_reaction) ? { learnedReaction: reaction(row.learned_reaction) } : {}),
    learnedReactionRevision: row.learned_reaction_revision,
    ...(row.favorite_at ? { favoriteAt: row.favorite_at } : {}),
    ...(row.watch_later_at ? { watchLaterAt: row.watch_later_at } : {}),
    ...(row.hidden_at ? { hiddenAt: row.hidden_at } : {}),
    ...(row.first_opened_at ? { firstOpenedAt: row.first_opened_at } : {}),
    ...(row.last_opened_at ? { lastOpenedAt: row.last_opened_at } : {}),
    updatedAt: row.updated_at,
  });
}

function duplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function boundedLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('limit must be between 1 and 100.');
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function reaction(value: string | null): 'liked' | 'disliked' | undefined {
  return value === 'liked' || value === 'disliked' ? value : undefined;
}

function requireString(value: string | null): string {
  if (!value) throw new Error('Required persisted value is missing.');
  return value;
}

function isOptions(
  input: DatabaseConnection | CreateRecommendationRepositoryOptions,
): input is CreateRecommendationRepositoryOptions {
  return 'database' in input;
}

class PublicationConflict extends Error {
  constructor(readonly candidateIds: readonly string[]) {
    super('Recommendation publication conflicts with current Candidate state.');
  }
}

interface CandidateRow extends DatabaseRow {
  readonly id: string;
  readonly content_identity: string;
  readonly source_id: string;
  readonly source_content_id: string | null;
  readonly canonical_url: string;
  readonly content_type: string;
  readonly title: string;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly description: string | null;
  readonly content_summary: string;
  readonly content_excerpt: string | null;
  readonly content_truncated: number;
  readonly cover_url: string | null;
}

interface StateRow extends DatabaseRow {
  readonly id: string;
  readonly recommendation_id: string;
  readonly reaction: string | null;
  readonly reaction_revision: number;
  readonly reaction_sequence: number;
  readonly reaction_changed_at: string | null;
  readonly learned_reaction: string | null;
  readonly learned_reaction_revision: number;
  readonly favorite_at: string | null;
  readonly watch_later_at: string | null;
  readonly hidden_at: string | null;
  readonly first_opened_at: string | null;
  readonly last_opened_at: string | null;
  readonly updated_at: string;
}

interface RecommendationRow extends StateRow {
  readonly candidate_id: string;
  readonly content_identity: string;
  readonly local_date: string;
  readonly position: number;
  readonly recommendation_reason: string;
  readonly selection_basis_json: string;
  readonly recommendation_published_at: string;
  readonly content_id: string;
  readonly source_id: string;
  readonly source_name: string;
  readonly source_content_id: string | null;
  readonly canonical_url: string;
  readonly content_type: string;
  readonly title: string;
  readonly author: string | null;
  readonly content_published_at: string | null;
  readonly description: string | null;
  readonly content_summary: string;
  readonly content_excerpt: string | null;
  readonly content_truncated: number;
  readonly cover_url: string | null;
  readonly state_id: string;
}
