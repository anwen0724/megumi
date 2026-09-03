/*
 * Owns durable Preference Learning batches over Recommendation Reaction revisions
 * and commits complete Preference scope revisions atomically.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  LearnedScopeInputSchema,
  PreferenceLearningBatchSchema,
  PreferenceLearningCompletionSchema,
  PreferenceSnapshotSchema,
  type CommitPreferenceLearningBatchResult,
  type LearnedScopeInput,
  type PreferenceLearningBatch,
  type PreferenceLearningCompletion,
  type PreferenceLearningFacts,
  type PreferenceLearningReactionChange,
  type PreferenceLearningTrigger,
  type PreferenceSnapshot,
} from '../preferences/preference';
import {
  RecommendationContentSchema,
  RecommendationSelectionBasisSchema,
  type RecommendationContent,
} from '../recommendation/recommendation';

type CommitRejectionReason = Extract<
  CommitPreferenceLearningBatchResult,
  { readonly status: 'rejected' }
>['reason'];

const TimestampSchema = z.string().datetime({ offset: true });
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
const ReactionSnapshotSchema = z.object({
  recommendationId: z.string().min(1),
  learnedReaction: z.enum(['liked', 'disliked']).optional(),
  learnedReactionRevision: z.number().int().nonnegative(),
  currentReaction: z.enum(['liked', 'disliked']).optional(),
  currentReactionRevision: z.number().int().positive(),
  changedAt: TimestampSchema,
  selectionBasis: RecommendationSelectionBasisSchema,
  content: RecommendationContentSchema,
  recommendationReason: z.string().trim().min(1),
  recommendationPublishedAt: TimestampSchema,
}).strict();
const ReactionSnapshotsSchema = z.array(ReactionSnapshotSchema).min(1).max(20);

type ReactionSnapshot = z.infer<typeof ReactionSnapshotSchema>;

export interface PreferenceLearningRepository {
  getPreferenceLearningBatch(batchId: string): PreferenceLearningBatch | undefined;
  getPreferenceLearningCompletion(recommendationId: string): PreferenceLearningCompletion | undefined;
  getPreferenceLearningTrigger(input: { readonly now: string }): PreferenceLearningTrigger;
  claimPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly reason: 'threshold' | 'deadline' | 'correction' | 'retry';
    readonly now: string;
    readonly limit: number;
  }): PreferenceLearningBatch | undefined;
  getPreferenceLearningFacts(batchId: string): PreferenceLearningFacts | undefined;
  commitPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly committedAt: string;
    readonly scopes: readonly LearnedScopeInput[];
  }): CommitPreferenceLearningBatchResult;
  listPreferenceSnapshots(): readonly PreferenceSnapshot[];
  interruptPreferenceLearningBatches(input: { readonly now: string }): number;
  failPreferenceLearningBatch(input: {
    readonly batchId: string;
    readonly failedAt: string;
    readonly retryAt: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): void;
}

/** Creates the persistence boundary used by Recommendation Reaction learning. */
export function createPreferenceLearningRepository(
  database: DatabaseConnection,
): PreferenceLearningRepository {
  return {
    getPreferenceLearningBatch: (batchId) => readBatch(database, batchId),
    getPreferenceLearningCompletion: (recommendationId) => readCompletion(database, recommendationId),
    getPreferenceLearningTrigger: ({ now }) => readTrigger(database, now),
    claimPreferenceLearningBatch: (input) => claimBatch(database, input),
    getPreferenceLearningFacts: (batchId) => readFacts(database, batchId),
    commitPreferenceLearningBatch: (input) => commitBatch(database, input),
    listPreferenceSnapshots: () => listPreferenceSnapshots(database),
    interruptPreferenceLearningBatches: ({ now }) => interruptBatches(database, now),
    failPreferenceLearningBatch: (input) => failBatch(database, input),
  };
}

function readTrigger(database: DatabaseConnection, rawNow: string): PreferenceLearningTrigger {
  const now = TimestampSchema.parse(rawNow);
  const running = database.prepare<CountRow>({
    sql: "SELECT COUNT(*) AS count FROM discovery_preference_learning_batches WHERE status = 'running'",
  }).get()?.count ?? 0;
  if (running > 0) return { status: 'idle' };

  const failedRows = database.prepare<BatchRow>({ sql: `
    SELECT * FROM discovery_preference_learning_batches
    WHERE status = 'failed' AND retry_at IS NOT NULL ORDER BY created_at, batch_id
  ` }).all();
  for (const failed of failedRows) {
    if (!snapshotsAreCurrent(database, parseSnapshots(failed.reaction_snapshots_json))) {
      database.prepare({
        sql: 'UPDATE discovery_preference_learning_batches SET retry_at = NULL WHERE batch_id = ?',
      }).run([failed.batch_id]);
      continue;
    }
    if (failed.retry_at && Date.parse(failed.retry_at) <= Date.parse(now)) {
      return { status: 'ready', reason: 'retry', pendingReactionCount: failed.change_count };
    }
    if (failed.retry_at) {
      return { status: 'scheduled', pendingReactionCount: failed.change_count, dueAt: failed.retry_at };
    }
  }

  const pending = database.prepare<PendingSummaryRow>({ sql: `
    SELECT COUNT(*) AS count, MIN(reaction_changed_at) AS oldest_changed_at,
      MAX(CASE WHEN learned_reaction_revision > 0 THEN 1 ELSE 0 END) AS has_correction
    FROM discovery_recommendation_states
    WHERE reaction_revision > learned_reaction_revision
  ` }).get();
  const count = pending?.count ?? 0;
  if (count === 0 || !pending?.oldest_changed_at) return { status: 'idle' };
  if ((pending.has_correction ?? 0) > 0) {
    return { status: 'ready', reason: 'correction', pendingReactionCount: count };
  }
  if (count >= 3) return { status: 'ready', reason: 'threshold', pendingReactionCount: count };
  const dueAt = new Date(Date.parse(pending.oldest_changed_at) + 10 * 60_000).toISOString();
  return Date.parse(now) >= Date.parse(dueAt)
    ? { status: 'ready', reason: 'deadline', pendingReactionCount: count }
    : { status: 'scheduled', pendingReactionCount: count, dueAt };
}

function claimBatch(
  database: DatabaseConnection,
  input: Parameters<PreferenceLearningRepository['claimPreferenceLearningBatch']>[0],
): PreferenceLearningBatch | undefined {
  const parsed = ClaimBatchSchema.parse(input);
  return database.transaction({ operation: () => {
    const trigger = readTrigger(database, parsed.now);
    if (trigger.status !== 'ready' || trigger.reason !== parsed.reason) return undefined;
    if (parsed.reason === 'retry') return retryBatch(database, parsed.now);

    const snapshots = listPendingSnapshots(database, parsed.limit);
    if (snapshots.length === 0) return undefined;
    database.prepare({ sql: `
      INSERT INTO discovery_preference_learning_batches (
        batch_id, status, trigger_reason, change_count, retry_count, created_at, started_at,
        reaction_snapshots_json, result_revisions_json
      ) VALUES (?, 'running', ?, ?, 0, ?, ?, ?, '[]')
    ` }).run([
      parsed.batchId,
      parsed.reason,
      snapshots.length,
      parsed.now,
      parsed.now,
      JSON.stringify(snapshots),
    ]);
    return readBatch(database, parsed.batchId);
  } });
}

function retryBatch(database: DatabaseConnection, now: string): PreferenceLearningBatch | undefined {
  const failed = database.prepare<BatchRow>({ sql: `
    SELECT * FROM discovery_preference_learning_batches
    WHERE status = 'failed' AND retry_at <= ? ORDER BY created_at, batch_id LIMIT 1
  ` }).get([now]);
  if (!failed || !snapshotsAreCurrent(database, parseSnapshots(failed.reaction_snapshots_json))) {
    return undefined;
  }
  database.prepare({ sql: `
    UPDATE discovery_preference_learning_batches
    SET status = 'running', trigger_reason = 'retry', retry_count = retry_count + 1,
        retry_at = NULL, started_at = ?, completed_at = NULL,
        failure_code = NULL, failure_message = NULL
    WHERE batch_id = ? AND status = 'failed'
  ` }).run([now, failed.batch_id]);
  return readBatch(database, failed.batch_id);
}

function readFacts(database: DatabaseConnection, batchId: string): PreferenceLearningFacts | undefined {
  const row = getBatchRow(database, z.string().min(1).parse(batchId));
  if (!row) return undefined;
  const batch = readBatch(database, batchId);
  if (!batch) return undefined;
  const snapshots = parseSnapshots(row.reaction_snapshots_json);
  const scopes = affectedScopes(database, snapshots);
  return {
    batch,
    affectedScopes: scopes,
    currentPreferences: scopes.flatMap(({ scopeKey }) => {
      const snapshot = readPreferenceSnapshot(database, scopeKey);
      return snapshot ? [snapshot] : [];
    }),
    reactionChanges: snapshots.map((snapshot) => toReactionChange(database, snapshot)),
  };
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
    const structuralProblem = validateCommitStructure(database, facts, parsed.scopes);
    if (structuralProblem) return { status: 'rejected', reason: structuralProblem };
    for (const change of facts.reactionChanges) {
      const current = database.prepare<ReactionRevisionRow>({
        sql: 'SELECT reaction_revision FROM discovery_recommendation_states WHERE recommendation_id = ?',
      }).get([change.recommendationId]);
      if (!current || current.reaction_revision !== change.currentReactionRevision) {
        return { status: 'rejected', reason: 'revision_conflict' };
      }
    }

    const revisions: Array<{ scopeKey: string; revision: number }> = [];
    const affectedInterestIds: string[] = [];
    for (const scope of facts.affectedScopes) {
      const next = parsed.scopes.find(({ scopeKey }) => scopeKey === scope.scopeKey);
      if (!next) return { status: 'rejected', reason: 'scope_mismatch' };
      const nextRevision = scope.baseRevision + 1;
      replacePreferenceScope(database, scope, next, nextRevision, parsed.committedAt);
      revisions.push({ scopeKey: scope.scopeKey, revision: nextRevision });
      if (scope.interestId) affectedInterestIds.push(scope.interestId);
    }
    for (const change of facts.reactionChanges) {
      const result = database.prepare({ sql: `
        UPDATE discovery_recommendation_states
        SET learned_reaction = ?, learned_reaction_revision = ?
        WHERE recommendation_id = ? AND reaction_revision = ?
      ` }).run([
        change.currentReaction ?? null,
        change.currentReactionRevision,
        change.recommendationId,
        change.currentReactionRevision,
      ]);
      if (result.changes !== 1) return { status: 'rejected', reason: 'revision_conflict' };
    }
    database.prepare({ sql: `
      UPDATE discovery_preference_learning_batches
      SET status = 'succeeded', completed_at = ?, retry_at = NULL,
          failure_code = NULL, failure_message = NULL, result_revisions_json = ?
      WHERE batch_id = ? AND status = 'running'
    ` }).run([parsed.committedAt, JSON.stringify(revisions), parsed.batchId]);
    return {
      status: 'committed',
      revisions,
      affectedInterestIds: [...new Set(affectedInterestIds)].sort(),
    };
  } });
}

function validateCommitStructure(
  database: DatabaseConnection,
  facts: PreferenceLearningFacts,
  scopes: readonly LearnedScopeInput[],
): CommitRejectionReason | undefined {
  const expectedKeys = facts.affectedScopes.map(({ scopeKey }) => scopeKey).sort();
  const actualKeys = scopes.map(({ scopeKey }) => scopeKey).sort();
  if (!sameStrings(expectedKeys, actualKeys) || new Set(actualKeys).size !== actualKeys.length) {
    return 'scope_mismatch';
  }
  for (const scope of facts.affectedScopes) {
    const next = scopes.find(({ scopeKey }) => scopeKey === scope.scopeKey);
    if (!next || next.baseRevision !== scope.baseRevision) return 'revision_conflict';
    if (scope.interestId && !isValidInterest(database, scope.interestId)) {
      return 'invalid_interest_reference';
    }
    const directionProblem = validateDirections(database, scope, next);
    if (directionProblem) return directionProblem;
  }
  return undefined;
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
  const validIds = validRecommendationIdsForScope(database, scope);
  for (const direction of input.directions) {
    if (direction.supportingRecommendationIds.some((id) => !validIds.has(id))) {
      return 'invalid_recommendation_reference';
    }
  }
  return undefined;
}

function replacePreferenceScope(
  database: DatabaseConnection,
  scope: PreferenceLearningFacts['affectedScopes'][number],
  input: LearnedScopeInput,
  revision: number,
  updatedAt: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_preference_scopes (scope_key, scope, interest_id, revision, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope_key) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at
  ` }).run([scope.scopeKey, scope.scope, scope.interestId ?? null, revision, updatedAt]);
  database.prepare({ sql: 'DELETE FROM discovery_preference_directions WHERE scope_key = ?' })
    .run([scope.scopeKey]);
  for (const direction of input.directions) {
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
      updatedAt,
    ]);
    for (const recommendationId of direction.supportingRecommendationIds) {
      database.prepare({ sql: `
        INSERT INTO discovery_preference_direction_recommendations (id, direction_id, recommendation_id)
        VALUES (?, ?, ?)
      ` }).run([randomUUID(), direction.directionId, recommendationId]);
    }
  }
}

function validRecommendationIdsForScope(
  database: DatabaseConnection,
  scope: PreferenceLearningFacts['affectedScopes'][number],
): ReadonlySet<string> {
  const rows = database.prepare<SelectionBasisRow>({
    sql: 'SELECT id, selection_basis_json FROM discovery_recommendations',
  }).all();
  return new Set(rows.flatMap((row) => {
    const basis = RecommendationSelectionBasisSchema.parse(JSON.parse(row.selection_basis_json));
    const valid = scope.scope === 'exploration'
      ? basis.matchedInterestIds.length === 0
      : Boolean(scope.interestId && basis.matchedInterestIds.includes(scope.interestId));
    return valid ? [row.id] : [];
  }));
}

function listPendingSnapshots(database: DatabaseConnection, limit: number): readonly ReactionSnapshot[] {
  return database.prepare<ReactionSnapshotRow>({ sql: `
    SELECT r.id AS recommendation_id, r.recommendation_reason, r.selection_basis_json,
      r.published_at AS recommendation_published_at,
      c.id AS content_id, c.source_id, c.source_name, c.source_content_id, c.canonical_url,
      c.content_type, c.title, c.author, c.content_published_at, c.description,
      c.content_summary, c.content_excerpt, c.content_truncated, c.cover_url,
      s.reaction, s.reaction_revision, s.reaction_changed_at,
      s.learned_reaction, s.learned_reaction_revision
    FROM discovery_recommendation_states s
    JOIN discovery_recommendations r ON r.id = s.recommendation_id
    JOIN discovery_recommendation_contents c ON c.recommendation_id = r.id
    WHERE s.reaction_revision > s.learned_reaction_revision
    ORDER BY s.reaction_changed_at, r.id LIMIT ?
  ` }).all([limit]).map(snapshotFromRow);
}

function snapshotFromRow(row: ReactionSnapshotRow): ReactionSnapshot {
  return ReactionSnapshotSchema.parse({
    recommendationId: row.recommendation_id,
    ...(isReaction(row.learned_reaction) ? { learnedReaction: row.learned_reaction } : {}),
    learnedReactionRevision: row.learned_reaction_revision,
    ...(isReaction(row.reaction) ? { currentReaction: row.reaction } : {}),
    currentReactionRevision: row.reaction_revision,
    changedAt: requireString(row.reaction_changed_at),
    selectionBasis: JSON.parse(row.selection_basis_json),
    content: contentFromRow(row),
    recommendationReason: row.recommendation_reason,
    recommendationPublishedAt: row.recommendation_published_at,
  });
}

function contentFromRow(row: ReactionSnapshotRow): RecommendationContent {
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

function toReactionChange(
  database: DatabaseConnection,
  snapshot: ReactionSnapshot,
): PreferenceLearningReactionChange {
  return {
    recommendationId: snapshot.recommendationId,
    ...(snapshot.learnedReaction ? { learnedReaction: snapshot.learnedReaction } : {}),
    learnedReactionRevision: snapshot.learnedReactionRevision,
    ...(snapshot.currentReaction ? { currentReaction: snapshot.currentReaction } : {}),
    currentReactionRevision: snapshot.currentReactionRevision,
    changedAt: snapshot.changedAt,
    requiresCorrection: snapshot.learnedReactionRevision > 0,
    recommendation: {
      title: snapshot.content.title,
      sourceName: snapshot.content.sourceName,
      ...(snapshot.content.author ? { author: snapshot.content.author } : {}),
      contentType: snapshot.content.contentType,
      publishedAt: snapshot.content.contentPublishedAt ?? snapshot.recommendationPublishedAt,
      recommendationReason: snapshot.recommendationReason,
      matchedInterestIds: snapshot.selectionBasis.matchedInterestIds,
      contentEvidence: {
        sourceId: snapshot.content.sourceId,
        canonicalUrl: snapshot.content.canonicalUrl,
        title: snapshot.content.title,
        ...(snapshot.content.description ? { description: snapshot.content.description } : {}),
        ...(snapshot.content.contentExcerpt ? { contentText: snapshot.content.contentExcerpt } : {}),
        completeness: snapshot.content.contentExcerpt
          ? snapshot.content.contentTruncated ? 'partial' : 'full'
          : 'metadata_only',
      },
    },
    previouslySupportedDirectionIds: previousDirectionIds(database, snapshot.recommendationId),
  };
}

function affectedScopes(database: DatabaseConnection, snapshots: readonly ReactionSnapshot[]) {
  const keys = new Map<string, { scope: 'interest' | 'exploration'; interestId?: string }>();
  for (const snapshot of snapshots) {
    if (snapshot.selectionBasis.matchedInterestIds.length === 0) {
      keys.set('exploration', { scope: 'exploration' });
    }
    for (const interestId of snapshot.selectionBasis.matchedInterestIds) {
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

function previousDirectionIds(database: DatabaseConnection, recommendationId: string): readonly string[] {
  return database.prepare<DirectionIdRow>({ sql: `
    SELECT direction_id FROM discovery_preference_direction_recommendations
    WHERE recommendation_id = ? ORDER BY direction_id
  ` }).all([recommendationId]).map(({ direction_id }) => direction_id);
}

function snapshotsAreCurrent(database: DatabaseConnection, snapshots: readonly ReactionSnapshot[]): boolean {
  return snapshots.every((snapshot) => database.prepare<ReactionRevisionRow>({
    sql: 'SELECT reaction_revision FROM discovery_recommendation_states WHERE recommendation_id = ?',
  }).get([snapshot.recommendationId])?.reaction_revision === snapshot.currentReactionRevision);
}

function listPreferenceSnapshots(database: DatabaseConnection): readonly PreferenceSnapshot[] {
  return database.prepare<ScopeRow>({
    sql: 'SELECT * FROM discovery_preference_scopes ORDER BY scope_key',
  }).all().map((row) => requirePreferenceSnapshot(database, row.scope_key));
}

function readPreferenceSnapshot(database: DatabaseConnection, scopeKey: string): PreferenceSnapshot | undefined {
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

function preferenceSnapshotFromRow(database: DatabaseConnection, row: ScopeRow): PreferenceSnapshot {
  const directions = database.prepare<DirectionRow>({ sql: `
    SELECT * FROM discovery_preference_directions WHERE scope_key = ? ORDER BY direction_id
  ` }).all([row.scope_key]).map((direction) => ({
    directionId: direction.direction_id,
    polarity: z.enum(['positive', 'negative']).parse(direction.polarity),
    dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality'])
      .parse(direction.dimension),
    statement: direction.statement,
    supportingRecommendationIds: previousRecommendationIds(database, direction.direction_id),
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

function previousRecommendationIds(database: DatabaseConnection, directionId: string): readonly string[] {
  return database.prepare<RecommendationIdRow>({ sql: `
    SELECT recommendation_id FROM discovery_preference_direction_recommendations
    WHERE direction_id = ? ORDER BY recommendation_id
  ` }).all([directionId]).map(({ recommendation_id }) => recommendation_id);
}

function interruptBatches(database: DatabaseConnection, rawNow: string): number {
  const now = TimestampSchema.parse(rawNow);
  return database.prepare({ sql: `
    UPDATE discovery_preference_learning_batches
    SET status = 'failed', retry_at = ?, completed_at = ?,
        failure_code = 'interrupted', failure_message = 'Preference Learning was interrupted.'
    WHERE status = 'running'
  ` }).run([now, now]).changes;
}

function failBatch(
  database: DatabaseConnection,
  input: Parameters<PreferenceLearningRepository['failPreferenceLearningBatch']>[0],
): void {
  database.prepare({ sql: `
    UPDATE discovery_preference_learning_batches
    SET status = 'failed', retry_at = ?, completed_at = ?, failure_code = ?, failure_message = ?
    WHERE batch_id = ? AND status = 'running'
  ` }).run([
    TimestampSchema.parse(input.retryAt),
    TimestampSchema.parse(input.failedAt),
    z.string().min(1).parse(input.failureCode),
    input.failureMessage,
    input.batchId,
  ]);
}

function readBatch(database: DatabaseConnection, batchId: string): PreferenceLearningBatch | undefined {
  const row = getBatchRow(database, z.string().min(1).parse(batchId));
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
    ...(row.status === 'succeeded' ? { resultRevisions: JSON.parse(row.result_revisions_json) } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
    ...(row.failure_message !== null ? { failureMessage: row.failure_message } : {}),
  });
}

function getBatchRow(database: DatabaseConnection, batchId: string): BatchRow | undefined {
  return database.prepare<BatchRow>({
    sql: 'SELECT * FROM discovery_preference_learning_batches WHERE batch_id = ?',
  }).get([batchId]);
}

function readCompletion(
  database: DatabaseConnection,
  recommendationId: string,
): PreferenceLearningCompletion | undefined {
  const state = database.prepare<CompletionStateRow>({ sql: `
    SELECT reaction_revision, learned_reaction_revision, reaction_changed_at
    FROM discovery_recommendation_states WHERE recommendation_id = ?
  ` }).get([z.string().min(1).parse(recommendationId)]);
  if (!state?.reaction_changed_at) return undefined;
  if (state.reaction_revision === state.learned_reaction_revision) {
    return PreferenceLearningCompletionSchema.parse({
      recommendationId,
      status: 'learned',
      resultRevisions: [],
      changedAt: state.reaction_changed_at,
    });
  }
  const batches = database.prepare<BatchRow>({
    sql: 'SELECT * FROM discovery_preference_learning_batches ORDER BY created_at DESC, batch_id DESC',
  }).all();
  const matched = batches.find((batch) => parseSnapshots(batch.reaction_snapshots_json).some(
    (snapshot) => snapshot.recommendationId === recommendationId
      && snapshot.currentReactionRevision === state.reaction_revision,
  ));
  if (!matched) {
    return PreferenceLearningCompletionSchema.parse({
      recommendationId,
      status: 'pending',
      resultRevisions: [],
      changedAt: state.reaction_changed_at,
    });
  }
  const failed = matched.status === 'failed';
  return PreferenceLearningCompletionSchema.parse({
    recommendationId,
    status: failed ? 'failed' : 'batched',
    batchId: matched.batch_id,
    resultRevisions: JSON.parse(matched.result_revisions_json),
    ...(failed ? {
      failure: {
        code: matched.failure_code ?? 'preference_learning_failed',
        message: matched.failure_message ?? 'Preference Learning failed.',
      },
    } : {}),
    changedAt: state.reaction_changed_at,
    ...(matched.completed_at ? { completedAt: matched.completed_at } : {}),
  });
}

function parseSnapshots(value: string): readonly ReactionSnapshot[] {
  return ReactionSnapshotsSchema.parse(JSON.parse(value));
}

function isValidInterest(database: DatabaseConnection, interestId: string): boolean {
  const row = database.prepare<InterestStatusRow>({
    sql: 'SELECT status FROM discovery_interests WHERE interest_id = ?',
  }).get([interestId]);
  return Boolean(row && row.status !== 'deleted');
}

function interestScopeKey(interestId: string): string {
  return `interest:${interestId}`;
}

function isReaction(value: string | null): value is 'liked' | 'disliked' {
  return value === 'liked' || value === 'disliked';
}

function requireString(value: string | null): string {
  if (!value) throw new Error('Expected a non-empty persisted value.');
  return value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface CountRow extends DatabaseRow { readonly count: number }
interface PendingSummaryRow extends DatabaseRow {
  readonly count: number;
  readonly oldest_changed_at: string | null;
  readonly has_correction: number | null;
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
  readonly reaction_snapshots_json: string;
  readonly result_revisions_json: string;
}
interface ReactionSnapshotRow extends DatabaseRow {
  readonly recommendation_id: string;
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
  readonly reaction: string | null;
  readonly reaction_revision: number;
  readonly reaction_changed_at: string | null;
  readonly learned_reaction: string | null;
  readonly learned_reaction_revision: number;
}
interface ReactionRevisionRow extends DatabaseRow { readonly reaction_revision: number }
interface SelectionBasisRow extends DatabaseRow { readonly id: string; readonly selection_basis_json: string }
interface ScopeKeyRow extends DatabaseRow { readonly scope_key: string }
interface RevisionRow extends DatabaseRow { readonly revision: number }
interface InterestStatusRow extends DatabaseRow { readonly status: string }
interface DirectionIdRow extends DatabaseRow { readonly direction_id: string }
interface RecommendationIdRow extends DatabaseRow { readonly recommendation_id: string }
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
interface CompletionStateRow extends DatabaseRow {
  readonly reaction_revision: number;
  readonly learned_reaction_revision: number;
  readonly reaction_changed_at: string | null;
}
