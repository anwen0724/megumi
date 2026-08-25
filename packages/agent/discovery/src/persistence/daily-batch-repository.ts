/*
 * Owns Daily Discovery Batch claims, retries, failures, and atomic publication.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  DailyDiscoveryBatchSchema,
  LocalDateSchema,
  type DailyDiscoveryBatch,
} from '../daily-discovery/daily-discovery';
import { RecommendationSchema, type Recommendation } from '../recommendations/recommendation';
import type { RecommendationPublicationWriter } from './recommendation-repository';

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
type RunningDailyDiscoveryBatch = Extract<DailyDiscoveryBatch, { readonly status: 'running' }>;
type PublishedDailyDiscoveryBatch = Extract<DailyDiscoveryBatch, { readonly status: 'published' }>;
type FailedDailyDiscoveryBatch = Extract<DailyDiscoveryBatch, { readonly status: 'failed' }>;

export type ClaimDailyBatchResult =
  | { readonly status: 'claimed'; readonly batch: RunningDailyDiscoveryBatch }
  | { readonly status: 'in_progress'; readonly batch: RunningDailyDiscoveryBatch }
  | { readonly status: 'already_published'; readonly batch: PublishedDailyDiscoveryBatch }
  | { readonly status: 'failed'; readonly batch: FailedDailyDiscoveryBatch };

export type PublishDailyBatchResult =
  | {
      readonly status: 'published';
      readonly batch: PublishedDailyDiscoveryBatch;
      readonly recommendations: readonly Recommendation[];
    }
  | {
      readonly status: 'conflict';
      readonly reason: 'batch_not_running' | 'execution_mismatch' | 'publication_conflict';
    };

export type FailDailyAttemptResult =
  | { readonly status: 'retry_claimed'; readonly batch: RunningDailyDiscoveryBatch }
  | { readonly status: 'failed'; readonly batch: FailedDailyDiscoveryBatch }
  | { readonly status: 'conflict' };

export interface DailyBatchRepository {
  /** Reads the Batch for one local calendar date. */
  getDailyBatch(localDate: string): DailyDiscoveryBatch | undefined;
  /** Lists interrupted running Batches that need startup recovery. */
  listRunningDailyBatches(): readonly RunningDailyDiscoveryBatch[];
  /** Claims the single Batch for a local date or returns its authoritative state. */
  claimDailyBatch(command: ClaimDailyBatch): ClaimDailyBatchResult;
  /** Atomically publishes a Recommendation set and its Batch state. */
  publishDailyBatch(command: PublishDailyBatch): PublishDailyBatchResult;
  /** Marks the current execution of a Batch failed. */
  failDailyBatch(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
    readonly failedAt: string;
  }): boolean;
  /** Fails one attempt and atomically claims its automatic retry when available. */
  failDailyAttempt(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly nextExecutionId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
    readonly failedAt: string;
  }): FailDailyAttemptResult;
  /** Restarts a failed Batch for an explicit user retry. */
  retryFailedDailyBatch(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly targetCount: number;
    readonly startedAt: string;
  }): RunningDailyDiscoveryBatch | undefined;
}

/** Creates the Batch persistence implementation and its publication transaction. */
export function createDailyBatchRepository(
  database: DatabaseConnection,
  recommendations: RecommendationPublicationWriter,
): DailyBatchRepository {
  return {
    getDailyBatch(localDate) {
      return readBatchByLocalDate(database, LocalDateSchema.parse(localDate));
    },
    listRunningDailyBatches() {
      return database.prepare<BatchRow>({ sql: `
        SELECT * FROM discovery_batches WHERE status = 'running' ORDER BY local_date, batch_id
      ` }).all().map(batchFromRow).map(requireRunningBatch);
    },
    claimDailyBatch(command) {
      const parsed = ClaimDailyBatchSchema.parse(command);
      const existing = readBatchByLocalDate(database, parsed.localDate);
      if (existing) return existingClaimResult(existing);
      try {
        return database.transaction({
          operation: () => {
            database.prepare({ sql: `
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
              batch: requireRunningBatch(readBatchByIdRequired(database, parsed.batchId)),
            };
          },
        });
      } catch (error) {
        const authoritative = readBatchByLocalDate(database, parsed.localDate);
        if (authoritative) return existingClaimResult(authoritative);
        throw new Error('Daily discovery batch could not be claimed.', { cause: error });
      }
    },
    publishDailyBatch(command) {
      const parsed = PublishDailyBatchSchema.parse(command);
      if (parsed.recommendations.some((item) => item.batchId !== parsed.batchId)) {
        return { status: 'conflict', reason: 'publication_conflict' };
      }
      const identities = new Set(parsed.recommendations.map((item) => item.contentIdentity));
      if (identities.size !== parsed.recommendations.length) {
        return { status: 'conflict', reason: 'publication_conflict' };
      }
      try {
        return database.transaction({
          operation: () => {
            const batch = readBatchById(database, parsed.batchId);
            if (!batch || batch.status !== 'running') {
              throw new PublicationConflict('batch_not_running');
            }
            if (batch.executionId !== parsed.executionId) {
              throw new PublicationConflict('execution_mismatch');
            }
            for (const recommendation of parsed.recommendations) {
              recommendations.insertForPublication(recommendation);
            }
            const updated = database.prepare({ sql: `
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
              batch: requirePublishedBatch(readBatchByIdRequired(database, parsed.batchId)),
              recommendations: parsed.recommendations,
            };
          },
        });
      } catch (error) {
        if (error instanceof PublicationConflict) {
          return { status: 'conflict', reason: error.reason };
        }
        throw error;
      }
    },
    failDailyBatch(command) {
      TimestampSchema.parse(command.failedAt);
      if (!command.batchId || !command.executionId || !command.failureCode) {
        throw new Error('Daily discovery failure requires stable identifiers and a failure code.');
      }
      const updated = database.prepare({ sql: `
        UPDATE discovery_batches
        SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ?
        WHERE batch_id = ? AND status = 'running' AND execution_id = ?
      ` }).run([
        command.failureCode,
        command.failureMessage,
        command.failedAt,
        command.batchId,
        command.executionId,
      ]);
      return updated.changes === 1;
    },
    failDailyAttempt(command) {
      TimestampSchema.parse(command.failedAt);
      return database.transaction({
        operation: () => {
          const batch = readBatchById(database, command.batchId);
          if (!batch || batch.status !== 'running' || batch.executionId !== command.executionId) {
            return { status: 'conflict' as const };
          }
          if (batch.automaticRetryCount < 2) {
            database.prepare({ sql: `
              UPDATE discovery_batches
              SET execution_id = ?, attempt_count = attempt_count + 1,
                  automatic_retry_count = automatic_retry_count + 1,
                  failure_code = NULL, failure_message = NULL,
                  started_at = ?, updated_at = ?
              WHERE batch_id = ? AND status = 'running' AND execution_id = ?
            ` }).run([
              command.nextExecutionId,
              command.failedAt,
              command.failedAt,
              command.batchId,
              command.executionId,
            ]);
            return {
              status: 'retry_claimed' as const,
              batch: requireRunningBatch(readBatchByIdRequired(database, command.batchId)),
            };
          }
          database.prepare({ sql: `
            UPDATE discovery_batches
            SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ?
            WHERE batch_id = ? AND status = 'running' AND execution_id = ?
          ` }).run([
            command.failureCode,
            command.failureMessage,
            command.failedAt,
            command.batchId,
            command.executionId,
          ]);
          return {
            status: 'failed' as const,
            batch: requireFailedBatch(readBatchByIdRequired(database, command.batchId)),
          };
        },
      });
    },
    retryFailedDailyBatch(command) {
      TimestampSchema.parse(command.startedAt);
      if (!Number.isInteger(command.targetCount) || command.targetCount < 1 || command.targetCount > 100) {
        throw new Error('Daily discovery targetCount must be between 1 and 100.');
      }
      return database.transaction({
        operation: () => {
          const batch = readBatchById(database, command.batchId);
          if (!batch || batch.status !== 'failed') return undefined;
          database.prepare({ sql: `
            UPDATE discovery_batches
            SET status = 'running', execution_id = ?, target_count = ?,
                attempt_count = attempt_count + 1, failure_code = NULL, failure_message = NULL,
                started_at = ?, updated_at = ?
            WHERE batch_id = ? AND status = 'failed'
          ` }).run([
            command.executionId,
            command.targetCount,
            command.startedAt,
            command.startedAt,
            command.batchId,
          ]);
          return requireRunningBatch(readBatchByIdRequired(database, command.batchId));
        },
      });
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

function requireRunningBatch(batch: DailyDiscoveryBatch): RunningDailyDiscoveryBatch {
  if (batch.status !== 'running') throw new Error(`Expected a running Batch, received ${batch.status}.`);
  return batch;
}

function requirePublishedBatch(batch: DailyDiscoveryBatch): PublishedDailyDiscoveryBatch {
  if (batch.status !== 'published') throw new Error(`Expected a published Batch, received ${batch.status}.`);
  return batch;
}

function requireFailedBatch(batch: DailyDiscoveryBatch): FailedDailyDiscoveryBatch {
  if (batch.status !== 'failed') throw new Error(`Expected a failed Batch, received ${batch.status}.`);
  return batch;
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
