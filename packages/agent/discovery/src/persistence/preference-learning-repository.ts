/*
 * Owns Recommendation Feedback change persistence, Preference Learning Batch
 * recovery, and atomic Preference revision commits.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  LearnedScopeInputSchema,
  PreferenceLearningBatchSchema,
  PreferenceSnapshotSchema,
  type CommitPreferenceLearningBatchResult,
  type FeedbackReaction,
  type LearnedScopeInput,
  type PreferenceLearningBatch,
  type PreferenceLearningFacts,
  type PreferenceLearningTrigger,
  type PreferenceSnapshot,
} from '../preferences/preference';

type CommitRejectionReason = Extract<
  CommitPreferenceLearningBatchResult,
  { readonly status: 'rejected' }
>['reason'];

const TimestampSchema = z.string().datetime({ offset: true });
const StringArraySchema = z.array(z.string().min(1));
const JsonObjectSchema = z.record(z.string(), z.unknown());
const ClaimBatchSchema = z.object({
  batchId: z.string().min(1),
  reason: z.enum(['threshold', 'deadline', 'correction', 'retry']),
  now: TimestampSchema,
  limit: z.number().int().min(1).max(20),
}).strict();
const CommitBatchSchema = z.object({
  batchId: z.string().min(1),
  committedAt: TimestampSchema,
  scopes: z.array(LearnedScopeInputSchema),
}).strict();

export interface PreferenceLearningRepository {
  /** Reports the next deterministic learning action without starting work. */
  readPreferenceLearningTrigger(input: { readonly now: string }): PreferenceLearningTrigger;
  /** Claims either a new fixed Change batch or the oldest due failed batch. */
  claimPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly reason: 'threshold' | 'deadline' | 'correction' | 'retry';
    readonly now: string;
    readonly limit: number;
  }): PreferenceLearningBatch | undefined;
  /** Reads the immutable Recommendation and current Preference facts for one fixed batch. */
  readPreferenceLearningFacts(batchId: string): PreferenceLearningFacts | undefined;
  /** Atomically replaces every affected Preference scope with its complete next revision. */
  commitPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly committedAt: string;
    readonly scopes: readonly LearnedScopeInput[];
  }): CommitPreferenceLearningBatchResult;
  /** Returns every current stable Preference snapshot in deterministic order. */
  listPreferenceSnapshots(): readonly PreferenceSnapshot[];
  /** Marks an interrupted running batch retryable without changing Feedback state. */
  interruptPreferenceLearningBatches(input: { readonly now: string }): number;
  /** Preserves the same fixed batch for a retry after a failed model or commit attempt. */
  failPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly failedAt: string;
    readonly retryAt: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): void;
}

export interface RecordRecommendationFeedbackInput {
  readonly recommendationId: string;
  readonly reaction: FeedbackReaction | null;
  readonly feedbackId: string;
  readonly feedbackChangeId: string;
  readonly now: string;
}

/** Records one real reaction transition inside the caller-owned transaction. */
export function recordRecommendationFeedbackChange(
  database: DatabaseConnection,
  input: RecordRecommendationFeedbackInput,
): void {
  const now = TimestampSchema.parse(input.now);
  const current = database.prepare<RecommendationFeedbackRow>({ sql: `
    SELECT recommendation_id, reaction, feedback_id, feedback_revision, learned_feedback_revision
    FROM discovery_recommendations WHERE recommendation_id = ?
  ` }).get([z.string().min(1).parse(input.recommendationId)]);
  if (!current) throw new Error(`Recommendation not found: ${input.recommendationId}.`);
  const reaction = input.reaction === null ? null : z.enum(['liked', 'disliked']).parse(input.reaction);
  if (current.reaction === reaction) return;

  const feedbackId = current.feedback_id ?? z.string().min(1).parse(input.feedbackId);
  const nextRevision = current.feedback_revision + 1;
  const hasInFlightChange = database.prepare<CountRow>({ sql: `
    SELECT COUNT(*) AS count FROM discovery_feedback_changes
    WHERE feedback_id = ? AND status = 'batched'
  ` }).get([feedbackId])?.count ?? 0;
  const requiresCorrection = current.learned_feedback_revision >= current.feedback_revision
    && current.feedback_revision > 0
    || hasInFlightChange > 0;

  database.prepare({ sql: `
    UPDATE discovery_feedback_changes SET status = 'superseded'
    WHERE feedback_id = ? AND status = 'pending'
  ` }).run([feedbackId]);
  const status = reaction === null && current.learned_feedback_revision === 0 && !requiresCorrection
    ? 'ignored'
    : 'pending';
  database.prepare({ sql: `
    UPDATE discovery_recommendations
    SET reaction = ?, feedback_id = ?, feedback_revision = ?, state_updated_at = ?
    WHERE recommendation_id = ?
  ` }).run([reaction, feedbackId, nextRevision, now, input.recommendationId]);
  database.prepare({ sql: `
    INSERT INTO discovery_feedback_changes (
      feedback_change_id, feedback_id, recommendation_id, previous_reaction,
      current_reaction, feedback_revision, status, requires_correction, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    z.string().min(1).parse(input.feedbackChangeId),
    feedbackId,
    input.recommendationId,
    current.reaction,
    reaction,
    nextRevision,
    status,
    requiresCorrection ? 1 : 0,
    now,
  ]);
}

/** Creates the deep persistence boundary used by Feedback and Preference Learning. */
export function createPreferenceLearningRepository(
  database: DatabaseConnection,
): PreferenceLearningRepository {
  return {
    readPreferenceLearningTrigger: ({ now }) => readTrigger(database, now),
    claimPreferenceLearningBatch: (input) => claimBatch(database, input),
    readPreferenceLearningFacts: (batchId) => readFacts(database, batchId),
    commitPreferenceLearningBatch: (input) => commitBatch(database, input),
    listPreferenceSnapshots: () => listPreferenceSnapshots(database),
    interruptPreferenceLearningBatches: ({ now }) => interruptBatches(database, now),
    failPreferenceLearningBatch: (input) => failBatch(database, input),
  };
}

function readTrigger(database: DatabaseConnection, rawNow: string): PreferenceLearningTrigger {
  const now = TimestampSchema.parse(rawNow);
  const running = database.prepare<CountRow>({ sql: `
    SELECT COUNT(*) AS count FROM discovery_preference_learning_batches WHERE status = 'running'
  ` }).get()?.count ?? 0;
  if (running > 0) return { status: 'idle' };
  const failed = database.prepare<BatchRow>({ sql: `
    SELECT * FROM discovery_preference_learning_batches
    WHERE status = 'failed' ORDER BY created_at, batch_id LIMIT 1
  ` }).get();
  if (failed) {
    if (failed.retry_at && Date.parse(failed.retry_at) <= Date.parse(now)) {
      return { status: 'ready', reason: 'retry', pendingFeedbackCount: failed.change_count };
    }
    if (failed.retry_at) {
      return { status: 'scheduled', pendingFeedbackCount: failed.change_count, dueAt: failed.retry_at };
    }
  }
  const pending = database.prepare<PendingSummaryRow>({ sql: `
    SELECT COUNT(*) AS count, MIN(changed_at) AS oldest_changed_at,
      MAX(requires_correction) AS has_correction
    FROM discovery_feedback_changes WHERE status = 'pending'
  ` }).get();
  const count = pending?.count ?? 0;
  if (count === 0 || !pending?.oldest_changed_at) return { status: 'idle' };
  if ((pending.has_correction ?? 0) > 0) {
    return { status: 'ready', reason: 'correction', pendingFeedbackCount: count };
  }
  if (count >= 3) return { status: 'ready', reason: 'threshold', pendingFeedbackCount: count };
  const dueAt = new Date(Date.parse(pending.oldest_changed_at) + 10 * 60_000).toISOString();
  return Date.parse(now) >= Date.parse(dueAt)
    ? { status: 'ready', reason: 'deadline', pendingFeedbackCount: count }
    : { status: 'scheduled', pendingFeedbackCount: count, dueAt };
}

function claimBatch(
  database: DatabaseConnection,
  input: Parameters<PreferenceLearningRepository['claimPreferenceLearningBatch']>[0],
): PreferenceLearningBatch | undefined {
  const parsed = ClaimBatchSchema.parse(input);
  return database.transaction({
    operation: () => {
      const trigger = readTrigger(database, parsed.now);
      if (trigger.status !== 'ready' || trigger.reason !== parsed.reason) return undefined;
      if (parsed.reason === 'retry') {
        const failed = database.prepare<BatchRow>({ sql: `
          SELECT * FROM discovery_preference_learning_batches
          WHERE status = 'failed' AND retry_at <= ? ORDER BY created_at, batch_id LIMIT 1
        ` }).get([parsed.now]);
        if (!failed) return undefined;
        database.prepare({ sql: `
          UPDATE discovery_preference_learning_batches
          SET status = 'running', trigger_reason = 'retry', retry_count = retry_count + 1,
              retry_at = NULL, started_at = ?, completed_at = NULL,
              failure_code = NULL, failure_message = NULL
          WHERE batch_id = ? AND status = 'failed'
        ` }).run([parsed.now, failed.batch_id]);
        return readBatch(database, failed.batch_id);
      }

      const changes = database.prepare<ChangeRow>({ sql: `
        SELECT * FROM discovery_feedback_changes
        WHERE status = 'pending' ORDER BY changed_at, feedback_change_id LIMIT ?
      ` }).all([parsed.limit]);
      if (changes.length === 0) return undefined;
      database.prepare({ sql: `
        INSERT INTO discovery_preference_learning_batches (
          batch_id, status, trigger_reason, change_count, retry_count, created_at, started_at
        ) VALUES (?, 'running', ?, ?, 0, ?, ?)
      ` }).run([parsed.batchId, parsed.reason, changes.length, parsed.now, parsed.now]);
      for (const change of changes) {
        database.prepare({ sql: `
          UPDATE discovery_feedback_changes SET status = 'batched', batch_id = ?
          WHERE feedback_change_id = ? AND status = 'pending'
        ` }).run([parsed.batchId, change.feedback_change_id]);
      }
      return readBatch(database, parsed.batchId);
    },
  });
}

function readFacts(database: DatabaseConnection, batchId: string): PreferenceLearningFacts | undefined {
  const batch = readBatch(database, z.string().min(1).parse(batchId));
  if (!batch) return undefined;
  const rows = database.prepare<LearningChangeRow>({ sql: `
    SELECT c.*, r.title, r.source_name, r.author, r.content_type,
      r.published_at, r.recommendation_reason, r.matched_interest_ids_json,
      r.content_evidence_json
    FROM discovery_feedback_changes c
    JOIN discovery_recommendations r ON r.recommendation_id = c.recommendation_id
    WHERE c.batch_id = ? ORDER BY c.changed_at, c.feedback_change_id
  ` }).all([batchId]);
  const affectedScopes = affectedScopesFromRows(database, rows);
  const currentPreferences = affectedScopes.flatMap(({ scopeKey }) => {
    const snapshot = readPreferenceSnapshot(database, scopeKey);
    return snapshot ? [snapshot] : [];
  });
  return {
    batch,
    affectedScopes,
    currentPreferences,
    feedbackChanges: rows.map((row) => ({
      feedbackChangeId: row.feedback_change_id,
      feedbackId: row.feedback_id,
      recommendationId: row.recommendation_id,
      ...(isReaction(row.previous_reaction) ? { previousReaction: row.previous_reaction } : {}),
      ...(isReaction(row.current_reaction) ? { currentReaction: row.current_reaction } : {}),
      feedbackRevision: row.feedback_revision,
      changedAt: row.changed_at,
      requiresCorrection: row.requires_correction === 1,
      recommendation: {
        title: row.title,
        sourceName: row.source_name,
        ...(row.author ? { author: row.author } : {}),
        contentType: row.content_type,
        publishedAt: row.published_at,
        recommendationReason: row.recommendation_reason,
        matchedInterestIds: parseStringArray(row.matched_interest_ids_json),
        contentEvidence: parseJsonObject(row.content_evidence_json),
      },
      previouslySupportedDirectionIds: database.prepare<DirectionIdRow>({ sql: `
        SELECT direction_id FROM discovery_preference_direction_feedback
        WHERE feedback_id = ? ORDER BY direction_id
      ` }).all([row.feedback_id]).map(({ direction_id }) => direction_id),
    })),
  };
}

function affectedScopesFromRows(
  database: DatabaseConnection,
  rows: readonly LearningChangeRow[],
) {
  const keys = new Map<string, { scope: 'interest' | 'exploration'; interestId?: string }>();
  for (const row of rows) {
    const interestIds = parseStringArray(row.matched_interest_ids_json);
    if (interestIds.length === 0) {
      keys.set('exploration', { scope: 'exploration' });
      continue;
    }
    for (const interestId of interestIds) {
      keys.set(interestScopeKey(interestId), { scope: 'interest', interestId });
    }
  }
  return [...keys.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([scopeKey, value]) => ({
    scopeKey,
    scope: value.scope,
    ...(value.interestId ? { interestId: value.interestId } : {}),
    baseRevision: database.prepare<RevisionRow>({
      sql: 'SELECT revision FROM discovery_preference_scopes WHERE scope_key = ?',
    }).get([scopeKey])?.revision ?? 0,
  }));
}

function commitBatch(
  database: DatabaseConnection,
  input: Parameters<PreferenceLearningRepository['commitPreferenceLearningBatch']>[0],
): CommitPreferenceLearningBatchResult {
  const parsed = CommitBatchSchema.parse(input);
  return database.transaction({ operation: () => {
    const facts = readFacts(database, parsed.batchId);
    if (!facts || facts.batch.status !== 'running') {
      return { status: 'rejected', reason: 'batch_not_running' };
    }
    const expectedKeys = facts.affectedScopes.map(({ scopeKey }) => scopeKey).sort();
    const actualKeys = parsed.scopes.map(({ scopeKey }) => scopeKey).sort();
    if (!sameStrings(expectedKeys, actualKeys)) return { status: 'rejected', reason: 'scope_mismatch' };
    if (new Set(actualKeys).size !== actualKeys.length) return { status: 'rejected', reason: 'scope_mismatch' };

    for (const scope of facts.affectedScopes) {
      const inputScope = parsed.scopes.find(({ scopeKey }) => scopeKey === scope.scopeKey);
      if (!inputScope || inputScope.baseRevision !== scope.baseRevision) {
        return { status: 'rejected', reason: 'revision_conflict' };
      }
      if (scope.interestId) {
        const interest = database.prepare<InterestStatusRow>({
          sql: 'SELECT status FROM discovery_interests WHERE interest_id = ?',
        }).get([scope.interestId]);
        if (!interest || interest.status === 'deleted') {
          return { status: 'rejected', reason: 'invalid_interest_reference' };
        }
      }
      const directionProblem = validateDirections(database, scope, inputScope);
      if (directionProblem) return { status: 'rejected', reason: directionProblem };
    }

    for (const change of facts.feedbackChanges) {
      const current = database.prepare<CurrentFeedbackRow>({ sql: `
        SELECT feedback_revision FROM discovery_recommendations
        WHERE recommendation_id = ? AND feedback_id = ?
      ` }).get([change.recommendationId, change.feedbackId]);
      if (!current || current.feedback_revision !== change.feedbackRevision) {
        return { status: 'rejected', reason: 'revision_conflict' };
      }
    }

    const revisions: Array<{ scopeKey: string; revision: number }> = [];
    const affectedInterestIds: string[] = [];
    for (const scope of facts.affectedScopes) {
      const inputScope = parsed.scopes.find(({ scopeKey }) => scopeKey === scope.scopeKey);
      if (!inputScope) return { status: 'rejected', reason: 'scope_mismatch' };
      const nextRevision = scope.baseRevision + 1;
      database.prepare({ sql: `
        INSERT INTO discovery_preference_scopes (
          scope_key, scope, interest_id, revision, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(scope_key) DO UPDATE SET
          revision = excluded.revision, updated_at = excluded.updated_at
      ` }).run([
        scope.scopeKey,
        scope.scope,
        scope.interestId ?? null,
        nextRevision,
        parsed.committedAt,
      ]);
      database.prepare({
        sql: 'DELETE FROM discovery_preference_directions WHERE scope_key = ?',
      }).run([scope.scopeKey]);
      for (const direction of inputScope.directions) {
        database.prepare({ sql: `
          INSERT INTO discovery_preference_directions (
            direction_id, scope_key, polarity, dimension, statement, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        ` }).run([
          direction.directionId,
          scope.scopeKey,
          direction.polarity,
          direction.dimension,
          direction.statement,
          parsed.committedAt,
        ]);
        for (const feedbackId of direction.supportingFeedbackIds) {
          database.prepare({ sql: `
            INSERT INTO discovery_preference_direction_feedback (direction_id, feedback_id)
            VALUES (?, ?)
          ` }).run([direction.directionId, feedbackId]);
        }
      }
      revisions.push({ scopeKey: scope.scopeKey, revision: nextRevision });
      if (scope.interestId) affectedInterestIds.push(scope.interestId);
    }
    for (const change of facts.feedbackChanges) {
      database.prepare({ sql: `
        UPDATE discovery_feedback_changes SET status = 'processed', processed_at = ?
        WHERE feedback_change_id = ? AND status = 'batched'
      ` }).run([parsed.committedAt, change.feedbackChangeId]);
      database.prepare({ sql: `
        UPDATE discovery_recommendations SET learned_feedback_revision = ?
        WHERE recommendation_id = ? AND feedback_id = ? AND feedback_revision = ?
      ` }).run([
        change.feedbackRevision,
        change.recommendationId,
        change.feedbackId,
        change.feedbackRevision,
      ]);
    }
    database.prepare({ sql: `
      UPDATE discovery_preference_learning_batches
      SET status = 'succeeded', completed_at = ?, retry_at = NULL,
          failure_code = NULL, failure_message = NULL
      WHERE batch_id = ? AND status = 'running'
    ` }).run([parsed.committedAt, parsed.batchId]);
    return {
      status: 'committed',
      revisions,
      affectedInterestIds: [...new Set(affectedInterestIds)].sort(),
    };
  } });
}

function validateDirections(
  database: DatabaseConnection,
  scope: PreferenceLearningFacts['affectedScopes'][number],
  input: LearnedScopeInput,
): CommitRejectionReason | undefined {
  const directionIds = input.directions.map(({ directionId }) => directionId);
  if (new Set(directionIds).size !== directionIds.length) return 'invalid_direction_reference';
  for (const directionId of directionIds) {
    const owner = database.prepare<ScopeKeyRow>({
      sql: 'SELECT scope_key FROM discovery_preference_directions WHERE direction_id = ?',
    }).get([directionId]);
    if (owner && owner.scope_key !== scope.scopeKey) return 'invalid_direction_reference';
  }
  const validFeedbackIds = validFeedbackIdsForScope(database, scope);
  for (const direction of input.directions) {
    if (direction.supportingFeedbackIds.some((feedbackId) => !validFeedbackIds.has(feedbackId))) {
      return 'invalid_feedback_reference';
    }
  }
  return undefined;
}

function validFeedbackIdsForScope(
  database: DatabaseConnection,
  scope: PreferenceLearningFacts['affectedScopes'][number],
): ReadonlySet<string> {
  const rows = database.prepare<FeedbackScopeRow>({ sql: `
    SELECT feedback_id, matched_interest_ids_json FROM discovery_recommendations
    WHERE feedback_id IS NOT NULL AND reaction IS NOT NULL
  ` }).all();
  return new Set(rows.flatMap((row) => {
    const interestIds = parseStringArray(row.matched_interest_ids_json);
    const valid = scope.scope === 'exploration'
      ? interestIds.length === 0
      : Boolean(scope.interestId && interestIds.includes(scope.interestId));
    return valid ? [row.feedback_id] : [];
  }));
}

function listPreferenceSnapshots(database: DatabaseConnection): readonly PreferenceSnapshot[] {
  return database.prepare<ScopeRow>({ sql: `
    SELECT * FROM discovery_preference_scopes ORDER BY scope_key
  ` }).all().map((row) => requirePreferenceSnapshot(database, row.scope_key));
}

function readPreferenceSnapshot(
  database: DatabaseConnection,
  scopeKey: string,
): PreferenceSnapshot | undefined {
  const row = database.prepare<ScopeRow>({
    sql: 'SELECT * FROM discovery_preference_scopes WHERE scope_key = ?',
  }).get([scopeKey]);
  return row ? preferenceSnapshotFromRow(database, row) : undefined;
}

function requirePreferenceSnapshot(database: DatabaseConnection, scopeKey: string): PreferenceSnapshot {
  const snapshot = readPreferenceSnapshot(database, scopeKey);
  if (!snapshot) throw new Error(`Preference scope disappeared: ${scopeKey}.`);
  return snapshot;
}

function preferenceSnapshotFromRow(
  database: DatabaseConnection,
  row: ScopeRow,
): PreferenceSnapshot {
  const directions = database.prepare<DirectionRow>({ sql: `
    SELECT * FROM discovery_preference_directions WHERE scope_key = ? ORDER BY direction_id
  ` }).all([row.scope_key]).map((direction) => ({
    directionId: direction.direction_id,
    polarity: z.enum(['positive', 'negative']).parse(direction.polarity),
    dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality'])
      .parse(direction.dimension),
    statement: direction.statement,
    supportingFeedbackIds: database.prepare<FeedbackIdRow>({ sql: `
      SELECT feedback_id FROM discovery_preference_direction_feedback
      WHERE direction_id = ? ORDER BY feedback_id
    ` }).all([direction.direction_id]).map(({ feedback_id }) => feedback_id),
    updatedAt: direction.updated_at,
  }));
  return PreferenceSnapshotSchema.parse({
    scopeKey: row.scope_key,
    scope: row.scope,
    ...(row.interest_id ? { interestId: row.interest_id } : {}),
    revision: row.revision,
    directions,
    updatedAt: row.updated_at,
  });
}

function interruptBatches(database: DatabaseConnection, rawNow: string): number {
  const now = TimestampSchema.parse(rawNow);
  return database.transaction({ operation: () => database.prepare({ sql: `
    UPDATE discovery_preference_learning_batches
    SET status = 'failed', retry_at = ?, completed_at = ?,
        failure_code = 'interrupted', failure_message = 'Preference Learning was interrupted.'
    WHERE status = 'running'
  ` }).run([now, now]).changes });
}

function failBatch(
  database: DatabaseConnection,
  input: Parameters<PreferenceLearningRepository['failPreferenceLearningBatch']>[0],
): void {
  const failedAt = TimestampSchema.parse(input.failedAt);
  const retryAt = TimestampSchema.parse(input.retryAt);
  database.prepare({ sql: `
    UPDATE discovery_preference_learning_batches
    SET status = 'failed', retry_at = ?, completed_at = ?, failure_code = ?, failure_message = ?
    WHERE batch_id = ? AND status = 'running'
  ` }).run([
    retryAt,
    failedAt,
    z.string().min(1).parse(input.failureCode),
    input.failureMessage,
    input.batchId,
  ]);
}

function readBatch(database: DatabaseConnection, batchId: string): PreferenceLearningBatch | undefined {
  const row = database.prepare<BatchRow>({
    sql: 'SELECT * FROM discovery_preference_learning_batches WHERE batch_id = ?',
  }).get([batchId]);
  if (!row) return undefined;
  return PreferenceLearningBatchSchema.parse({
    batchId: row.batch_id,
    status: row.status,
    triggerReason: row.trigger_reason,
    changeCount: row.change_count,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    startedAt: row.started_at,
    ...(row.retry_at ? { retryAt: row.retry_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message !== null ? { failureMessage: row.failure_message } : {}),
  });
}

function interestScopeKey(interestId: string): string {
  return `interest:${interestId}`;
}

function parseStringArray(value: string): readonly string[] {
  return StringArraySchema.parse(JSON.parse(value));
}

function parseJsonObject(value: string): Readonly<Record<string, unknown>> {
  return JsonObjectSchema.parse(JSON.parse(value));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isReaction(value: string | null): value is FeedbackReaction {
  return value === 'liked' || value === 'disliked';
}

interface CountRow extends DatabaseRow { readonly count: number }
interface PendingSummaryRow extends DatabaseRow {
  readonly count: number;
  readonly oldest_changed_at: string | null;
  readonly has_correction: number | null;
}
interface RecommendationFeedbackRow extends DatabaseRow {
  readonly recommendation_id: string;
  readonly reaction: string | null;
  readonly feedback_id: string | null;
  readonly feedback_revision: number;
  readonly learned_feedback_revision: number;
}
interface ChangeRow extends DatabaseRow {
  readonly feedback_change_id: string;
  readonly feedback_id: string;
  readonly recommendation_id: string;
  readonly previous_reaction: string | null;
  readonly current_reaction: string | null;
  readonly feedback_revision: number;
  readonly status: string;
  readonly requires_correction: number;
  readonly batch_id: string | null;
  readonly changed_at: string;
  readonly processed_at: string | null;
}
interface LearningChangeRow extends ChangeRow {
  readonly title: string;
  readonly source_name: string;
  readonly author: string | null;
  readonly content_type: string;
  readonly published_at: string;
  readonly recommendation_reason: string;
  readonly matched_interest_ids_json: string;
  readonly content_evidence_json: string;
}
interface BatchRow extends DatabaseRow {
  readonly batch_id: string;
  readonly status: string;
  readonly trigger_reason: string;
  readonly change_count: number;
  readonly retry_count: number;
  readonly retry_at: string | null;
  readonly created_at: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly failure_code: string | null;
  readonly failure_message: string | null;
}
interface ScopeRow extends DatabaseRow {
  readonly scope_key: string;
  readonly scope: string;
  readonly interest_id: string | null;
  readonly revision: number;
  readonly updated_at: string;
}
interface DirectionRow extends DatabaseRow {
  readonly direction_id: string;
  readonly scope_key: string;
  readonly polarity: string;
  readonly dimension: string;
  readonly statement: string;
  readonly updated_at: string;
}
interface DirectionIdRow extends DatabaseRow { readonly direction_id: string }
interface FeedbackIdRow extends DatabaseRow { readonly feedback_id: string }
interface ScopeKeyRow extends DatabaseRow { readonly scope_key: string }
interface RevisionRow extends DatabaseRow { readonly revision: number }
interface InterestStatusRow extends DatabaseRow { readonly status: string }
interface CurrentFeedbackRow extends DatabaseRow { readonly feedback_revision: number }
interface FeedbackScopeRow extends DatabaseRow {
  readonly feedback_id: string;
  readonly matched_interest_ids_json: string;
}
