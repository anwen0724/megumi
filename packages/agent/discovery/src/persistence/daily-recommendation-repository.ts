/*
 * Owns Daily Recommendation's consistent Pool snapshot, Batch lifecycle, and atomic publication transaction.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { CandidateSchema, type Candidate } from '../candidate-supply/candidate-supply';
import { buildDailyCandidateWindow } from '../daily-recommendation/candidate-window';
import {
  DailyRecommendationBatchSchema,
  LocalDateSchema,
  type DailyRecommendationBatch,
  type DailyRecommendationCandidate,
  type DailyRecommendationSnapshot,
} from '../daily-recommendation/daily-recommendation';
import { RecommendationSchema, type Recommendation } from '../recommendations/recommendation';
import { createRecommendationRepository } from './recommendation-repository';

const TimestampSchema = z.string().datetime({ offset: true });
const ClaimBatchSchema = z.object({
  batchId: z.string().min(1),
  localDate: LocalDateSchema,
  timezone: z.string().trim().min(1),
  executionId: z.string().min(1),
  requestedCount: z.number().int().min(1).max(100),
  actualTarget: z.number().int().min(1).max(100),
  now: TimestampSchema,
}).strict().refine(({ actualTarget, requestedCount }) => actualTarget <= requestedCount, {
  message: 'actualTarget cannot exceed requestedCount.',
});
const PublishSchema = z.object({
  batchId: z.string().min(1),
  executionId: z.string().min(1),
  publishedAt: TimestampSchema,
  allowedCandidateIds: z.array(z.string().min(1)).min(1),
  items: z.array(z.object({
    recommendationId: z.string().min(1),
    candidateId: z.string().min(1),
    recommendationReason: z.string().trim().min(1).max(1000),
  }).strict()).min(1),
}).strict();

export type ClaimDailyRecommendationBatch = z.infer<typeof ClaimBatchSchema>;
export type PublishDailyRecommendations = z.infer<typeof PublishSchema>;
type RunningBatch = Extract<DailyRecommendationBatch, { readonly status: 'running' }>;
type PublishedBatch = Extract<DailyRecommendationBatch, { readonly status: 'published' }>;

export type ClaimDailyRecommendationBatchResult =
  | { readonly status: 'claimed'; readonly batch: RunningBatch }
  | { readonly status: 'in_progress'; readonly batch: RunningBatch }
  | { readonly status: 'already_published'; readonly batch: PublishedBatch }
  | { readonly status: 'failed'; readonly batch: Extract<DailyRecommendationBatch, { readonly status: 'failed' }> };

export type PublishDailyRecommendationsResult =
  | { readonly status: 'published'; readonly batch: PublishedBatch; readonly recommendations: readonly Recommendation[] }
  | { readonly status: 'already_published'; readonly batch: PublishedBatch; readonly recommendations: readonly Recommendation[] }
  | { readonly status: 'selection_conflict'; readonly unavailableCandidateIds: readonly string[] }
  | { readonly status: 'rejected'; readonly reason: 'batch_not_running' | 'execution_mismatch' | 'invalid_selection' };

export interface DailyRecommendationRepository {
  /** Reads the authoritative Batch for one local date. */
  getBatch(localDate: string): DailyRecommendationBatch | undefined;
  /** Reads one consistent and bounded Candidate, Interest, Recommendation, and feedback snapshot. */
  readSnapshot(input: { readonly now: string; readonly requestedCount: number }): DailyRecommendationSnapshot;
  /** Reads one persisted Candidate for an execution-scoped local-read Tool. */
  readCandidate(candidateId: string): Candidate | undefined;
  /** Claims the unique Batch for one local date. */
  claimBatch(command: ClaimDailyRecommendationBatch): ClaimDailyRecommendationBatchResult;
  /** Atomically creates Recommendation snapshots, consumes Candidates, and publishes the Batch. */
  publish(command: PublishDailyRecommendations): PublishDailyRecommendationsResult;
}

/** Creates the deep persistence module used by Daily Recommendation Runtime and Tool publication. */
export function createDailyRecommendationRepository(database: DatabaseConnection): DailyRecommendationRepository {
  const recommendationWriter = createRecommendationRepository(database).publicationWriter;
  return {
    getBatch(localDate) {
      return readBatchByLocalDate(database, LocalDateSchema.parse(localDate));
    },
    readSnapshot(input) {
      const now = TimestampSchema.parse(input.now);
      const requestedCount = requireRequestedCount(input.requestedCount);
      return database.transaction({
        operation: () => readSnapshot(database, now, requestedCount),
      });
    },
    readCandidate(candidateId) {
      const row = database.prepare<CandidateRow>({
        sql: 'SELECT * FROM discovery_candidates WHERE candidate_id = ?',
      }).get([z.string().min(1).parse(candidateId)]);
      return row ? candidateFromRow(row) : undefined;
    },
    claimBatch(command) {
      const parsed = ClaimBatchSchema.parse(command);
      const existing = readBatchByLocalDate(database, parsed.localDate);
      if (existing) return existingClaim(existing);
      try {
        return database.transaction({
          operation: () => {
            database.prepare({ sql: `
              INSERT INTO discovery_batches (
                batch_id, local_date, timezone, status, execution_id, requested_count, target_count,
                attempt_count, automatic_retry_count, result_count, created_at, updated_at, started_at
              ) VALUES (?, ?, ?, 'running', ?, ?, ?, 1, 0, 0, ?, ?, ?)
            ` }).run([
              parsed.batchId, parsed.localDate, parsed.timezone, parsed.executionId,
              parsed.requestedCount, parsed.actualTarget, parsed.now, parsed.now, parsed.now,
            ]);
            return {
              status: 'claimed' as const,
              batch: requireRunning(readBatchByIdRequired(database, parsed.batchId)),
            };
          },
        });
      } catch (error) {
        const authoritative = readBatchByLocalDate(database, parsed.localDate);
        if (authoritative) return existingClaim(authoritative);
        throw new Error('Daily Recommendation Batch could not be claimed.', { cause: error });
      }
    },
    publish(command) {
      const parsed = PublishSchema.parse(command);
      const existing = readBatchById(database, parsed.batchId);
      if (existing?.status === 'published') {
        if (existing.executionId !== parsed.executionId) {
          return { status: 'rejected', reason: 'execution_mismatch' };
        }
        return {
          status: 'already_published',
          batch: existing,
          recommendations: listRecommendationsByBatch(database, parsed.batchId),
        };
      }
      if (!validSelection(existing, parsed)) return { status: 'rejected', reason: 'invalid_selection' };
      try {
        return database.transaction({
          operation: () => publishSelection(database, recommendationWriter, parsed),
        });
      } catch (error) {
        if (error instanceof SelectionConflict) {
          return { status: 'selection_conflict', unavailableCandidateIds: error.candidateIds };
        }
        if (error instanceof BatchConflict) {
          return { status: 'rejected', reason: error.reason };
        }
        throw error;
      }
    },
  };
}

/** Reads all facts for one model decision under the caller's read transaction. */
function readSnapshot(
  database: DatabaseConnection,
  now: string,
  requestedCount: number,
): DailyRecommendationSnapshot {
  const activeInterests = database.prepare<InterestRow>({ sql: `
    SELECT interest_id, description FROM discovery_interests
    WHERE status = 'active' ORDER BY created_at, interest_id
  ` }).all().map((row) => ({ interestId: row.interest_id, description: row.description }));
  const candidates = database.prepare<CandidateAssessmentRow>({ sql: `
    SELECT c.*, a.relevance, a.matched_interest_ids_json, a.reason AS admission_reason
    FROM discovery_candidates c
    JOIN discovery_candidate_assessments a ON a.candidate_id = c.candidate_id
      AND a.active = 1 AND a.decision = 'admit'
    WHERE c.status = 'available' AND c.expires_at > ?
      AND NOT EXISTS (
        SELECT 1 FROM discovery_recommendations r
        WHERE r.candidate_id = c.candidate_id OR r.content_identity = c.content_identity
      )
    ORDER BY c.status_updated_at, c.candidate_id
  ` }).all([now]).map(candidateFromAssessmentRow);
  return {
    window: buildDailyCandidateWindow({
      now,
      requestedCount,
      activeInterestIds: activeInterests.map(({ interestId }) => interestId),
      candidates,
    }),
    activeInterests,
    recentRecommendations: listRecentRecommendations(database, now, 30, false),
    recentFeedback: listRecentRecommendations(database, now, 90, true),
  };
}

/** Commits the terminal business action while protecting the Agent's complete ordered selection. */
function publishSelection(
  database: DatabaseConnection,
  recommendationWriter: ReturnType<typeof createRecommendationRepository>['publicationWriter'],
  command: PublishDailyRecommendations,
): Extract<PublishDailyRecommendationsResult, { readonly status: 'published' }> {
  const batch = readBatchById(database, command.batchId);
  if (!batch || batch.status !== 'running') throw new BatchConflict('batch_not_running');
  if (batch.executionId !== command.executionId) throw new BatchConflict('execution_mismatch');
  if (!validSelection(batch, command)) throw new BatchConflict('invalid_selection');

  const selected = command.items.map((item) => ({ item, candidate: readPublishableCandidate(database, item.candidateId, command.publishedAt) }));
  const unavailableCandidateIds = selected
    .filter(({ candidate }) => candidate === undefined)
    .map(({ item }) => item.candidateId);
  if (unavailableCandidateIds.length > 0) throw new SelectionConflict(unavailableCandidateIds);

  const recommendations = selected.map(({ item, candidate }, position) => {
    if (!candidate) throw new Error('Publishable Candidate disappeared inside the publication transaction.');
    return RecommendationSchema.parse({
      recommendationId: item.recommendationId,
      batchId: command.batchId,
      candidateId: candidate.candidateId,
      contentIdentity: candidate.contentIdentity,
      position,
      sourceId: candidate.primarySourceId,
      sourceName: candidate.primarySourceName,
      canonicalUrl: candidate.canonicalUrl,
      contentType: candidate.contentType,
      ...(candidate.sourceContentId ? { sourceContentId: candidate.sourceContentId } : {}),
      title: candidate.title,
      ...(candidate.author ? { author: candidate.author } : {}),
      ...(candidate.publishedAt ? { contentPublishedAt: candidate.publishedAt } : {}),
      ...(candidate.description ? { description: candidate.description } : {}),
      ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
      recommendationReason: item.recommendationReason,
      publishedAt: command.publishedAt,
    });
  });

  for (const recommendation of recommendations) {
    const candidateId = recommendation.candidateId;
    if (!candidateId) throw new Error('New Daily Recommendation is missing its Candidate reference.');
    const updated = database.prepare({ sql: `
      UPDATE discovery_candidates SET status = 'consumed', status_updated_at = ?
      WHERE candidate_id = ? AND status = 'available' AND expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM discovery_recommendations r
          WHERE r.candidate_id = discovery_candidates.candidate_id
            OR r.content_identity = discovery_candidates.content_identity
        )
    ` }).run([command.publishedAt, candidateId, command.publishedAt]);
    if (updated.changes !== 1) throw new SelectionConflict([candidateId]);
    recommendationWriter.insertForPublication(recommendation);
  }

  const updatedBatch = database.prepare({ sql: `
    UPDATE discovery_batches
    SET status = 'published', result_count = ?, published_at = ?, updated_at = ?,
        failure_code = NULL, failure_message = NULL
    WHERE batch_id = ? AND status = 'running' AND execution_id = ?
  ` }).run([
    recommendations.length, command.publishedAt, command.publishedAt,
    command.batchId, command.executionId,
  ]);
  if (updatedBatch.changes !== 1) throw new BatchConflict('batch_not_running');
  return {
    status: 'published',
    batch: requirePublished(readBatchByIdRequired(database, command.batchId)),
    recommendations,
  };
}

function validSelection(
  batch: DailyRecommendationBatch | undefined,
  command: PublishDailyRecommendations,
): boolean {
  if (!batch || batch.status !== 'running' || batch.executionId !== command.executionId) return false;
  if (command.items.length !== batch.actualTarget) return false;
  const allowed = new Set(command.allowedCandidateIds);
  const candidateIds = command.items.map(({ candidateId }) => candidateId);
  const recommendationIds = command.items.map(({ recommendationId }) => recommendationId);
  return new Set(candidateIds).size === candidateIds.length
    && new Set(recommendationIds).size === recommendationIds.length
    && candidateIds.every((candidateId) => allowed.has(candidateId));
}

function readPublishableCandidate(
  database: DatabaseConnection,
  candidateId: string,
  now: string,
): Candidate | undefined {
  const row = database.prepare<CandidateRow>({ sql: `
    SELECT c.* FROM discovery_candidates c
    WHERE c.candidate_id = ? AND c.status = 'available' AND c.expires_at > ?
      AND EXISTS (
        SELECT 1 FROM discovery_candidate_assessments a
        WHERE a.candidate_id = c.candidate_id AND a.active = 1 AND a.decision = 'admit'
      )
      AND NOT EXISTS (
        SELECT 1 FROM discovery_recommendations r
        WHERE r.candidate_id = c.candidate_id OR r.content_identity = c.content_identity
      )
  ` }).get([candidateId, now]);
  return row ? candidateFromRow(row) : undefined;
}

function listRecentRecommendations(
  database: DatabaseConnection,
  now: string,
  days: number,
  feedbackOnly: boolean,
): readonly Recommendation[] {
  const cutoff = new Date(Date.parse(now) - days * 24 * 60 * 60 * 1000).toISOString();
  const feedbackFilter = feedbackOnly ? `AND (
    reaction IS NOT NULL OR hidden_at IS NOT NULL OR favorite_at IS NOT NULL
    OR watch_later_at IS NOT NULL OR first_opened_at IS NOT NULL
  )` : '';
  return database.prepare<RecommendationRow>({ sql: `
    SELECT * FROM discovery_recommendations
    WHERE published_at >= ? ${feedbackFilter}
    ORDER BY published_at DESC, position, recommendation_id LIMIT 50
  ` }).all([cutoff]).map(recommendationFromRow);
}

function listRecommendationsByBatch(database: DatabaseConnection, batchId: string): readonly Recommendation[] {
  return database.prepare<RecommendationRow>({ sql: `
    SELECT * FROM discovery_recommendations WHERE batch_id = ? ORDER BY position, recommendation_id
  ` }).all([batchId]).map(recommendationFromRow);
}

function recommendationFromRow(row: RecommendationRow): Recommendation {
  return RecommendationSchema.parse({
    recommendationId: row.recommendation_id,
    batchId: row.batch_id,
    ...(row.candidate_id ? { candidateId: row.candidate_id } : {}),
    contentIdentity: row.content_identity,
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
    ...(row.reaction === 'liked' || row.reaction === 'disliked' ? { reaction: row.reaction } : {}),
    ...(row.hidden_at ? { hiddenAt: row.hidden_at } : {}),
    ...(row.favorite_at ? { favoriteAt: row.favorite_at } : {}),
    ...(row.watch_later_at ? { watchLaterAt: row.watch_later_at } : {}),
    ...(row.first_opened_at ? { firstOpenedAt: row.first_opened_at } : {}),
    ...(row.last_opened_at ? { lastOpenedAt: row.last_opened_at } : {}),
    publishedAt: row.published_at,
    ...(row.state_updated_at ? { stateUpdatedAt: row.state_updated_at } : {}),
  });
}

function candidateFromAssessmentRow(row: CandidateAssessmentRow): DailyRecommendationCandidate {
  const candidate = candidateFromRow(row);
  return {
    ...candidate,
    admission: {
      relevance: z.enum(['direct', 'adjacent', 'exploration']).parse(row.relevance),
      matchedInterestIds: parseStringArray(row.matched_interest_ids_json),
      reason: row.admission_reason,
    },
  };
}

function candidateFromRow(row: CandidateRow): Candidate {
  return CandidateSchema.parse({
    candidateId: row.candidate_id,
    contentIdentity: row.content_identity,
    status: row.status,
    primarySourceId: row.primary_source_id,
    primarySourceName: row.primary_source_name,
    ...(row.source_content_id ? { sourceContentId: row.source_content_id } : {}),
    canonicalUrl: row.canonical_url,
    contentType: row.content_type,
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.content_published_at ? { publishedAt: row.content_published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.content_text ? { contentText: row.content_text } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    statusUpdatedAt: row.status_updated_at,
  });
}

function readBatchByIdRequired(database: DatabaseConnection, batchId: string): DailyRecommendationBatch {
  const batch = readBatchById(database, batchId);
  if (!batch) throw new Error(`Daily Recommendation Batch not found: ${batchId}.`);
  return batch;
}

function readBatchById(database: DatabaseConnection, batchId: string): DailyRecommendationBatch | undefined {
  const row = database.prepare<BatchRow>({ sql: 'SELECT * FROM discovery_batches WHERE batch_id = ?' }).get([batchId]);
  return row ? batchFromRow(row) : undefined;
}

function readBatchByLocalDate(database: DatabaseConnection, localDate: string): DailyRecommendationBatch | undefined {
  const row = database.prepare<BatchRow>({ sql: 'SELECT * FROM discovery_batches WHERE local_date = ?' }).get([localDate]);
  return row ? batchFromRow(row) : undefined;
}

function batchFromRow(row: BatchRow): DailyRecommendationBatch {
  return DailyRecommendationBatchSchema.parse({
    batchId: row.batch_id,
    localDate: row.local_date,
    timezone: row.timezone,
    status: row.status,
    executionId: row.execution_id,
    requestedCount: row.requested_count,
    actualTarget: row.target_count,
    attemptCount: row.attempt_count,
    automaticRetryCount: row.automatic_retry_count,
    resultCount: row.result_count,
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message !== null ? { failureMessage: row.failure_message } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
  });
}

function existingClaim(batch: DailyRecommendationBatch): ClaimDailyRecommendationBatchResult {
  if (batch.status === 'running') return { status: 'in_progress', batch };
  if (batch.status === 'published') return { status: 'already_published', batch };
  return { status: 'failed', batch };
}

function requireRunning(batch: DailyRecommendationBatch): RunningBatch {
  if (batch.status !== 'running') throw new Error(`Expected running Batch, received ${batch.status}.`);
  return batch;
}

function requirePublished(batch: DailyRecommendationBatch): PublishedBatch {
  if (batch.status !== 'published') throw new Error(`Expected published Batch, received ${batch.status}.`);
  return batch;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return z.array(z.string().min(1)).parse(parsed);
}

function requireRequestedCount(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('Daily Recommendation requestedCount must be between 1 and 100.');
  }
  return value;
}

class SelectionConflict extends Error {
  constructor(readonly candidateIds: readonly string[]) {
    super('Daily Recommendation selection changed before publication.');
  }
}

class BatchConflict extends Error {
  constructor(readonly reason: Extract<PublishDailyRecommendationsResult, { status: 'rejected' }>['reason']) {
    super(reason);
  }
}

type CandidateRow = DatabaseRow & {
  candidate_id: string; content_identity: string; status: string;
  primary_source_id: string; primary_source_name: string; source_content_id: string | null;
  canonical_url: string; content_type: string; title: string; author: string | null;
  content_published_at: string | null; description: string | null; content_text: string | null;
  cover_url: string | null; first_seen_at: string; last_seen_at: string;
  expires_at: string; status_updated_at: string;
};
type CandidateAssessmentRow = CandidateRow & {
  relevance: string | null; matched_interest_ids_json: string; admission_reason: string;
};
type InterestRow = DatabaseRow & { interest_id: string; description: string };
type BatchRow = DatabaseRow & {
  batch_id: string; local_date: string; timezone: string; status: string; execution_id: string;
  requested_count: number; target_count: number; attempt_count: number; automatic_retry_count: number;
  result_count: number; failure_code: string | null; failure_message: string | null;
  created_at: string; updated_at: string; started_at: string; published_at: string | null;
};
type RecommendationRow = DatabaseRow & {
  recommendation_id: string; batch_id: string; candidate_id: string | null; content_identity: string;
  position: number; source_id: string; source_name: string; canonical_url: string;
  content_type: string; source_content_id: string | null; title: string; author: string | null;
  content_published_at: string | null; description: string | null; cover_url: string | null;
  recommendation_reason: string; reaction: string | null; hidden_at: string | null;
  favorite_at: string | null; watch_later_at: string | null; first_opened_at: string | null;
  last_opened_at: string | null; published_at: string; state_updated_at: string | null;
};
