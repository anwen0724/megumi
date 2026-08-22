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
import {
  InterestDescriptionSchema,
  InterestEvidenceSchema,
  InterestSchema,
  SessionParticipationSchema,
  type Interest,
  type InterestEvidence,
  type SessionParticipation,
} from '../interests/interest';
import {
  readHome,
  searchRecommendations,
  updateRecommendationState,
  type ReadHomeQuery,
  type RecommendationStateCommand,
} from './discovery-query-repository';
import type {
  DiscoveryHomeView,
  SearchRecommendationsResult,
} from '../discovery-view';
import type { RecommendationView } from '../discovery-view';

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

export type FailDailyAttemptResult =
  | { readonly status: 'retry_claimed'; readonly batch: DailyDiscoveryBatch }
  | { readonly status: 'failed'; readonly batch: DailyDiscoveryBatch }
  | { readonly status: 'conflict' };

export interface RecommendationSelectionSignal {
  readonly contentIdentity: string;
  readonly sourceName: string;
  readonly title: string;
  readonly reaction?: 'liked' | 'disliked';
}

export type ValidatedInterestCommand =
  | { readonly action: 'create'; readonly interestId: string; readonly description: string; readonly now: string }
  | { readonly action: 'update'; readonly interestId: string; readonly description: string; readonly now: string }
  | { readonly action: 'pause' | 'resume' | 'delete'; readonly interestId: string; readonly now: string };

export interface ApplyInterestExtraction {
  readonly sessionId: string;
  readonly messageId: string;
  readonly now: string;
  readonly evidence: readonly {
    readonly evidenceId: string;
    readonly interestId: string;
    readonly description: string;
    readonly effect: 'support' | 'reject';
    readonly confidence: 'high' | 'medium';
    readonly matchedInterestId?: string;
    readonly supportingEvidenceIds?: readonly string[];
  }[];
}

export interface DiscoveryRepository {
  changeInterest(command: ValidatedInterestCommand): Interest;
  listInterests(): readonly Interest[];
  listPendingEvidence(): readonly InterestEvidence[];
  applyInterestExtraction(command: ApplyInterestExtraction): readonly Interest[];
  getSessionParticipation(sessionId: string): SessionParticipation | undefined;
  setSessionParticipation(command: {
    readonly sessionId: string;
    readonly participation: 'included' | 'excluded';
    readonly effectiveFrom: string;
    readonly updatedAt: string;
  }): SessionParticipation;
  retractSessionEvidence(sessionId: string, retractedAt: string): void;
  getDailyBatch(localDate: string): DailyDiscoveryBatch | undefined;
  listRunningDailyBatches(): readonly DailyDiscoveryBatch[];
  listRecommendationSelectionSignals(): readonly RecommendationSelectionSignal[];
  claimDailyBatch(command: ClaimDailyBatch): ClaimDailyBatchResult;
  publishDailyBatch(command: PublishDailyBatch): PublishDailyBatchResult;
  failDailyBatch(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
    readonly failedAt: string;
  }): boolean;
  failDailyAttempt(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly nextExecutionId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
    readonly failedAt: string;
  }): FailDailyAttemptResult;
  retryFailedDailyBatch(command: {
    readonly batchId: string;
    readonly executionId: string;
    readonly targetCount: number;
    readonly startedAt: string;
  }): DailyDiscoveryBatch | undefined;
  readHome(query: ReadHomeQuery): DiscoveryHomeView;
  searchRecommendations(query: {
    readonly query: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): SearchRecommendationsResult;
  updateRecommendationState(command: RecommendationStateCommand): RecommendationView;
}

export function createDiscoveryRepository(options: {
  readonly database: DatabaseConnection;
}): DiscoveryRepository {
  return {
    changeInterest(command) {
      return options.database.transaction({
        operation: () => changeInterest(options.database, command),
      });
    },

    listInterests() {
      return options.database.prepare<InterestRow>({ sql: `
        SELECT * FROM discovery_interests
        WHERE status <> 'deleted'
        ORDER BY created_at, interest_id
      ` }).all().map(interestFromRow);
    },

    listPendingEvidence() {
      return options.database.prepare<EvidenceRow>({ sql: `
        SELECT * FROM discovery_interest_evidence
        WHERE status = 'pending'
        ORDER BY created_at, evidence_id
      ` }).all().map(evidenceFromRow);
    },

    applyInterestExtraction(command) {
      return options.database.transaction({
        operation: () => applyInterestExtraction(options.database, command),
      });
    },

    getSessionParticipation(sessionId) {
      const row = options.database.prepare<SessionParticipationRow>({
        sql: 'SELECT * FROM discovery_session_policies WHERE session_id = ?',
      }).get([sessionId]);
      return row ? participationFromRow(row) : undefined;
    },

    setSessionParticipation(command) {
      return options.database.transaction({
        operation: () => {
          options.database.prepare({ sql: `
            INSERT INTO discovery_session_policies (
              session_id, participation, effective_from, updated_at
            ) VALUES (?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              participation = excluded.participation,
              effective_from = excluded.effective_from,
              updated_at = excluded.updated_at
          ` }).run([
            command.sessionId,
            command.participation,
            command.effectiveFrom,
            command.updatedAt,
          ]);
          return SessionParticipationSchema.parse(command);
        },
      });
    },

    retractSessionEvidence(sessionId, retractedAt) {
      options.database.transaction({
        operation: () => retractSessionEvidence(options.database, sessionId, retractedAt),
      });
    },

    getDailyBatch(localDate) {
      return readBatchByLocalDate(options.database, LocalDateSchema.parse(localDate));
    },

    listRunningDailyBatches() {
      return options.database.prepare<BatchRow>({ sql: `
        SELECT * FROM discovery_batches WHERE status = 'running' ORDER BY local_date, batch_id
      ` }).all().map(batchFromRow);
    },

    listRecommendationSelectionSignals() {
      return options.database.prepare<RecommendationSelectionSignalRow>({ sql: `
        SELECT content_identity, source_name, title, reaction
        FROM discovery_recommendations
        ORDER BY published_at, position, recommendation_id
      ` }).all().map((row) => ({
        contentIdentity: row.content_identity,
        sourceName: row.source_name,
        title: row.title,
        ...(row.reaction === 'liked' || row.reaction === 'disliked' ? { reaction: row.reaction } : {}),
      }));
    },

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

    failDailyBatch(command) {
      TimestampSchema.parse(command.failedAt);
      if (!command.batchId || !command.executionId || !command.failureCode) {
        throw new Error('Daily discovery failure requires stable identifiers and a failure code.');
      }
      const updated = options.database.prepare({ sql: `
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
      return options.database.transaction({
        operation: () => {
          const batch = readBatchById(options.database, command.batchId);
          if (!batch || batch.status !== 'running' || batch.executionId !== command.executionId) {
            return { status: 'conflict' as const };
          }
          if (batch.automaticRetryCount < 2) {
            options.database.prepare({ sql: `
              UPDATE discovery_batches
              SET execution_id = ?, attempt_count = attempt_count + 1,
                  automatic_retry_count = automatic_retry_count + 1,
                  failure_code = NULL, failure_message = NULL,
                  started_at = ?, updated_at = ?
              WHERE batch_id = ? AND status = 'running' AND execution_id = ?
            ` }).run([
              command.nextExecutionId, command.failedAt, command.failedAt,
              command.batchId, command.executionId,
            ]);
            return { status: 'retry_claimed' as const, batch: readBatchByIdRequired(options.database, command.batchId) };
          }
          options.database.prepare({ sql: `
            UPDATE discovery_batches
            SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ?
            WHERE batch_id = ? AND status = 'running' AND execution_id = ?
          ` }).run([
            command.failureCode, command.failureMessage, command.failedAt,
            command.batchId, command.executionId,
          ]);
          return { status: 'failed' as const, batch: readBatchByIdRequired(options.database, command.batchId) };
        },
      });
    },

    retryFailedDailyBatch(command) {
      TimestampSchema.parse(command.startedAt);
      if (!Number.isInteger(command.targetCount) || command.targetCount < 1 || command.targetCount > 100) {
        throw new Error('Daily discovery targetCount must be between 1 and 100.');
      }
      return options.database.transaction({
        operation: () => {
          const batch = readBatchById(options.database, command.batchId);
          if (!batch || batch.status !== 'failed') return undefined;
          options.database.prepare({ sql: `
            UPDATE discovery_batches
            SET status = 'running', execution_id = ?, target_count = ?,
                attempt_count = attempt_count + 1, failure_code = NULL, failure_message = NULL,
                started_at = ?, updated_at = ?
            WHERE batch_id = ? AND status = 'failed'
          ` }).run([
            command.executionId, command.targetCount, command.startedAt,
            command.startedAt, command.batchId,
          ]);
          return readBatchByIdRequired(options.database, command.batchId);
        },
      });
    },

    readHome: (query) => readHome(options.database, query),
    searchRecommendations: (query) => searchRecommendations(options.database, query),
    updateRecommendationState: (command) => options.database.transaction({
      operation: () => updateRecommendationState(options.database, command),
    }),
  };
}

function changeInterest(
  database: DatabaseConnection,
  command: ValidatedInterestCommand,
): Interest {
  if (command.action === 'create') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      INSERT INTO discovery_interests (
        interest_id, description, status, created_from, user_managed_at,
        created_at, updated_at
      ) VALUES (?, ?, 'active', 'manual', ?, ?, ?)
    ` }).run([command.interestId, description, command.now, command.now, command.now]);
    return readInterestRequired(database, command.interestId);
  }

  const current = readInterestRequired(database, command.interestId);
  if (current.status === 'deleted') return current;
  if (command.action === 'update') {
    const description = InterestDescriptionSchema.parse(command.description);
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET description = ?, user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([description, command.now, command.now, command.interestId]);
  } else if (command.action === 'pause') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'paused', paused_at = COALESCE(paused_at, ?),
          user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  } else if (command.action === 'resume') {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'active', paused_at = NULL, user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.interestId]);
  } else {
    database.prepare({ sql: `
      UPDATE discovery_interests
      SET status = 'deleted', deleted_at = COALESCE(deleted_at, ?),
          user_managed_at = ?, updated_at = ?
      WHERE interest_id = ?
    ` }).run([command.now, command.now, command.now, command.interestId]);
  }
  return readInterestRequired(database, command.interestId);
}

function applyInterestExtraction(
  database: DatabaseConnection,
  command: ApplyInterestExtraction,
): readonly Interest[] {
  const affected = new Set<string>();
  for (const candidate of command.evidence) {
    const description = InterestDescriptionSchema.parse(candidate.description);
    const matched = candidate.matchedInterestId
      ? readInterest(database, candidate.matchedInterestId)
      : undefined;
    if (candidate.matchedInterestId && (!matched || matched.status === 'deleted')) {
      throw new Error('Interest extraction referenced an unavailable Interest.');
    }

    const supporting = (candidate.supportingEvidenceIds ?? []).map((evidenceId) => {
      const evidence = readEvidence(database, evidenceId);
      if (!evidence || evidence.status !== 'pending' || evidence.messageId === command.messageId) {
        throw new Error('Interest extraction referenced unavailable supporting Evidence.');
      }
      return evidence;
    });

    let interest = matched;
    if (!interest && supporting.length > 0) {
      const supportingInterestIds = new Set(
        supporting.flatMap((evidence) => evidence.interestId ? [evidence.interestId] : []),
      );
      if (supportingInterestIds.size > 1) {
        throw new Error('Supporting Evidence refers to multiple Interests.');
      }
      const supportingInterestId = supportingInterestIds.values().next().value;
      interest = supportingInterestId
        ? readInterest(database, supportingInterestId)
        : undefined;
    }
    let status: 'pending' | 'applied' = 'pending';
    if (candidate.effect === 'support' && (
      candidate.confidence === 'high' || supporting.length > 0
    )) {
      if (!interest) {
        insertConversationInterest(database, candidate.interestId, description, command.now);
        interest = readInterestRequired(database, candidate.interestId);
      }
      status = 'applied';
      affected.add(interest.interestId);
      for (const evidence of supporting) {
        database.prepare({ sql: `
          UPDATE discovery_interest_evidence
          SET interest_id = ?, status = 'applied', applied_at = ?
          WHERE evidence_id = ? AND status = 'pending'
        ` }).run([interest.interestId, command.now, evidence.evidenceId]);
      }
    } else if (candidate.effect === 'reject' && candidate.confidence === 'high' && interest) {
      status = 'applied';
      affected.add(interest.interestId);
      if (!interest.userManagedAt) {
        database.prepare({ sql: `
          UPDATE discovery_interests
          SET status = 'paused', paused_at = COALESCE(paused_at, ?), updated_at = ?
          WHERE interest_id = ? AND status <> 'deleted'
        ` }).run([command.now, command.now, interest.interestId]);
      }
    }

    database.prepare({ sql: `
      INSERT INTO discovery_interest_evidence (
        evidence_id, interest_id, session_id, message_id, description,
        effect, confidence, status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ` }).run([
      candidate.evidenceId,
      interest?.interestId ?? null,
      command.sessionId,
      command.messageId,
      description,
      candidate.effect,
      candidate.confidence,
      status,
      command.now,
      status === 'applied' ? command.now : null,
    ]);
  }
  return [...affected].map((interestId) => readInterestRequired(database, interestId));
}

function insertConversationInterest(
  database: DatabaseConnection,
  interestId: string,
  description: string,
  now: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_interests (
      interest_id, description, status, created_from, created_at, updated_at
    ) VALUES (?, ?, 'active', 'conversation', ?, ?)
  ` }).run([interestId, description, now, now]);
}

function retractSessionEvidence(
  database: DatabaseConnection,
  sessionId: string,
  retractedAt: string,
): void {
  const evidence = database.prepare<EvidenceRow>({ sql: `
    SELECT * FROM discovery_interest_evidence
    WHERE session_id = ? AND status <> 'retracted'
  ` }).all([sessionId]);
  const affected = new Set(evidence.flatMap((item) => item.interest_id ? [item.interest_id] : []));
  database.prepare({ sql: `
    UPDATE discovery_interest_evidence
    SET status = 'retracted', retracted_at = ?
    WHERE session_id = ? AND status <> 'retracted'
  ` }).run([retractedAt, sessionId]);
  for (const interestId of affected) {
    const interest = readInterest(database, interestId);
    if (!interest || interest.createdFrom !== 'conversation' || interest.userManagedAt) continue;
    const support = database.prepare<{ count: number }>({ sql: `
      SELECT COUNT(*) AS count FROM discovery_interest_evidence
      WHERE interest_id = ? AND status = 'applied' AND effect = 'support'
    ` }).get([interestId])?.count ?? 0;
    if (support === 0) {
      database.prepare({ sql: `
        UPDATE discovery_interests
        SET status = 'deleted', deleted_at = ?, updated_at = ?
        WHERE interest_id = ? AND status <> 'deleted'
      ` }).run([retractedAt, retractedAt, interestId]);
    }
  }
}

function readInterestRequired(database: DatabaseConnection, interestId: string): Interest {
  const interest = readInterest(database, interestId);
  if (!interest) throw new Error('Interest was not found.');
  return interest;
}

function readInterest(database: DatabaseConnection, interestId: string): Interest | undefined {
  const row = database.prepare<InterestRow>({
    sql: 'SELECT * FROM discovery_interests WHERE interest_id = ?',
  }).get([interestId]);
  return row ? interestFromRow(row) : undefined;
}

function readEvidence(database: DatabaseConnection, evidenceId: string): InterestEvidence | undefined {
  const row = database.prepare<EvidenceRow>({
    sql: 'SELECT * FROM discovery_interest_evidence WHERE evidence_id = ?',
  }).get([evidenceId]);
  return row ? evidenceFromRow(row) : undefined;
}

function interestFromRow(row: InterestRow): Interest {
  return InterestSchema.parse({
    interestId: row.interest_id,
    description: row.description,
    status: row.status,
    createdFrom: row.created_from,
    ...(row.user_managed_at ? { userManagedAt: row.user_managed_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.paused_at ? { pausedAt: row.paused_at } : {}),
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
  });
}

function evidenceFromRow(row: EvidenceRow): InterestEvidence {
  return InterestEvidenceSchema.parse({
    evidenceId: row.evidence_id,
    ...(row.interest_id ? { interestId: row.interest_id } : {}),
    sessionId: row.session_id,
    messageId: row.message_id,
    description: row.description,
    effect: row.effect,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.created_at,
    ...(row.applied_at ? { appliedAt: row.applied_at } : {}),
    ...(row.retracted_at ? { retractedAt: row.retracted_at } : {}),
  });
}

function participationFromRow(row: SessionParticipationRow): SessionParticipation {
  return SessionParticipationSchema.parse({
    sessionId: row.session_id,
    participation: row.participation,
    effectiveFrom: row.effective_from,
    updatedAt: row.updated_at,
  });
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

type InterestRow = DatabaseRow & {
  interest_id: string;
  description: string;
  status: string;
  created_from: string;
  user_managed_at: string | null;
  created_at: string;
  updated_at: string;
  paused_at: string | null;
  deleted_at: string | null;
};

type EvidenceRow = DatabaseRow & {
  evidence_id: string;
  interest_id: string | null;
  session_id: string;
  message_id: string;
  description: string;
  effect: string;
  confidence: string;
  status: string;
  created_at: string;
  applied_at: string | null;
  retracted_at: string | null;
};

type SessionParticipationRow = DatabaseRow & {
  session_id: string;
  participation: string;
  effective_from: string;
  updated_at: string;
};

type RecommendationSelectionSignalRow = DatabaseRow & {
  content_identity: string;
  source_name: string;
  title: string;
  reaction: string | null;
};
