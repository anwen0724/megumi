/*
 * Owns durable Discovery transactions. Its public surface is expressed only
 * in business operations; SQL statements and transaction mechanics stay here.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  DailyDiscoveryBatchSchema,
  LocalDateSchema,
  type DailyDiscoveryBatch,
} from '../daily-discovery/daily-discovery';
import {
  RecommendationSchema,
  type Recommendation,
} from '../recommendations/recommendation';

const TimestampSchema = z.string().datetime({ offset: true });
const ClaimDailyBatchSchema = z.object({
  batchId: z.string().min(1),
  localDate: LocalDateSchema,
  timezone: z.string().trim().min(1),
  executionId: z.string().min(1),
  targetCount: z.number().int().min(1).max(100),
  now: TimestampSchema,
}).strict();

const PublishDailyBatchSchema = z.object({
  batchId: z.string().min(1),
  executionId: z.string().min(1),
  publishedAt: TimestampSchema,
  recommendations: z.array(RecommendationSchema),
}).strict();

export type ClaimDailyBatch = z.infer<typeof ClaimDailyBatchSchema>;
export type PublishDailyBatch = z.infer<typeof PublishDailyBatchSchema>;

export type ClaimDailyBatchResult =
  | { readonly status: 'claimed'; readonly batch: DailyDiscoveryBatch }
  | { readonly status: 'in_progress'; readonly batch: DailyDiscoveryBatch }
  | { readonly status: 'already_published'; readonly batch: DailyDiscoveryBatch }
  | { readonly status: 'failed'; readonly batch: DailyDiscoveryBatch };

export type PublishDailyBatchResult =
  | { readonly status: 'published'; readonly batch: DailyDiscoveryBatch; readonly recommendations: readonly Recommendation[] }
  | { readonly status: 'conflict'; readonly reason: 'batch_not_running' | 'execution_mismatch' | 'publication_conflict' };

export interface DiscoveryRepository {
  claimDailyBatch(command: ClaimDailyBatch): ClaimDailyBatchResult;
  publishDailyBatch(command: PublishDailyBatch): PublishDailyBatchResult;
}

export function createDiscoveryRepository(options: {
  readonly database: DatabaseConnection;
}): DiscoveryRepository {
  return {
    claimDailyBatch(command) {
      const parsed = ClaimDailyBatchSchema.parse(command);
      const existing = readBatchByLocalDate(options.database, parsed.localDate);
      if (existing) return existingClaimResult(existing);

      try {
        return options.database.transaction({
          operation: () => {
            options.database.prepare({ sql: `
              INSERT INTO discovery_batches (
                batch_id, local_date, timezone, status, execution_id, target_count,
                attempt_count, automatic_retry_count, result_count,
                created_at, updated_at, started_at
              ) VALUES (?, ?, ?, 'running', ?, ?, 1, 0, 0, ?, ?, ?)
            ` }).run([
              parsed.batchId,
              parsed.localDate,
              parsed.timezone,
              parsed.executionId,
              parsed.targetCount,
              parsed.now,
              parsed.now,
              parsed.now,
            ]);
            return {
              status: 'claimed' as const,
              batch: readBatchByIdRequired(options.database, parsed.batchId),
            };
          },
        });
      } catch {
        const authoritative = readBatchByLocalDate(options.database, parsed.localDate);
        if (authoritative) return existingClaimResult(authoritative);
        throw new Error('Daily discovery batch could not be claimed.');
      }
    },

    publishDailyBatch(command) {
      const parsed = PublishDailyBatchSchema.parse(command);
      if (parsed.recommendations.some((item) => item.batchId !== parsed.batchId)) {
        return { status: 'conflict', reason: 'publication_conflict' };
      }
      try {
        return options.database.transaction({
          operation: () => {
            const batch = readBatchById(options.database, parsed.batchId);
            if (!batch || batch.status !== 'running') {
              throw new PublicationConflict('batch_not_running');
            }
            if (batch.executionId !== parsed.executionId) {
              throw new PublicationConflict('execution_mismatch');
            }
            for (const recommendation of parsed.recommendations) {
              insertRecommendation(options.database, recommendation);
            }
            const updated = options.database.prepare({ sql: `
              UPDATE discovery_batches
              SET status = 'published', result_count = ?, published_at = ?, updated_at = ?,
                  failure_code = NULL, failure_message = NULL
              WHERE batch_id = ? AND status = 'running' AND execution_id = ?
            ` }).run([
              parsed.recommendations.length,
              parsed.publishedAt,
              parsed.publishedAt,
              parsed.batchId,
              parsed.executionId,
            ]);
            if (updated.changes !== 1) throw new PublicationConflict('publication_conflict');
            return {
              status: 'published' as const,
              batch: readBatchByIdRequired(options.database, parsed.batchId),
              recommendations: parsed.recommendations,
            };
          },
        });
      } catch (error) {
        return {
          status: 'conflict',
          reason: error instanceof PublicationConflict
            ? error.reason
            : 'publication_conflict',
        };
      }
    },
  };
}

class PublicationConflict extends Error {
  constructor(readonly reason: Extract<PublishDailyBatchResult, { status: 'conflict' }>['reason']) {
    super(reason);
  }
}

function existingClaimResult(batch: DailyDiscoveryBatch): ClaimDailyBatchResult {
  if (batch.status === 'running') return { status: 'in_progress', batch };
  if (batch.status === 'published') return { status: 'already_published', batch };
  return { status: 'failed', batch };
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

function readBatchByIdRequired(database: DatabaseConnection, batchId: string): DailyDiscoveryBatch {
  const batch = readBatchById(database, batchId);
  if (!batch) throw new Error('Claimed daily discovery batch was not found.');
  return batch;
}

function readBatchById(database: DatabaseConnection, batchId: string): DailyDiscoveryBatch | undefined {
  const row = database.prepare<BatchRow>({
    sql: 'SELECT * FROM discovery_batches WHERE batch_id = ?',
  }).get([batchId]);
  return row ? batchFromRow(row) : undefined;
}

function readBatchByLocalDate(
  database: DatabaseConnection,
  localDate: string,
): DailyDiscoveryBatch | undefined {
  const row = database.prepare<BatchRow>({
    sql: 'SELECT * FROM discovery_batches WHERE local_date = ?',
  }).get([localDate]);
  return row ? batchFromRow(row) : undefined;
}

function batchFromRow(row: BatchRow): DailyDiscoveryBatch {
  return DailyDiscoveryBatchSchema.parse({
    batchId: row.batch_id,
    localDate: row.local_date,
    timezone: row.timezone,
    status: row.status,
    executionId: row.execution_id,
    targetCount: row.target_count,
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

type BatchRow = DatabaseRow & {
  batch_id: string;
  local_date: string;
  timezone: string;
  status: string;
  execution_id: string;
  target_count: number;
  attempt_count: number;
  automatic_retry_count: number;
  result_count: number;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string;
  published_at: string | null;
};
