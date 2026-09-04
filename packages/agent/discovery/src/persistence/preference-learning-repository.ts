/*
 * Owns Preference entities and atomic feedback-version commits. Learning work is
 * a caller-owned snapshot; this repository never stores execution or retry history.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { z } from 'zod';
import {
  LearnedScopeInputSchema, PreferenceSchema, PreferenceSetSchema, PreferenceEvidenceSchema,
  type Preference, type PreferenceSet, type PreferenceEvidence, type PreferenceSetDetail,
  type LearnedScopeInput, type PreferenceLearningFacts, type PreferenceLearningTrigger,
  type PreferenceLearningCompletion, type CommitPreferenceLearningResult,
  type PreferenceLearningSupport,
} from '../preferences/preference';
import { createRecommendationRepository, type RecommendationRepository } from './recommendation-repository';
import type { Recommendation } from '../recommendation/recommendation';

const TimestampSchema = z.string().datetime({ offset: true });
const IdSchema = z.string().min(1);

export interface PreferenceLearningRepository {
  /** Finds durable entities by database identity; a missing row returns undefined. */
  findPreferenceSetById(id: string): PreferenceSet | undefined;
  findPreferenceById(id: string): Preference | undefined;
  findPreferenceEvidenceById(id: string): PreferenceEvidence | undefined;
  /** Returns the group and its related entities, not a synthetic database entity. */
  getPreferenceSetDetail(id: string): PreferenceSetDetail | undefined;
  /** effectiveOnly omits revoked support when preparing new Recommendation input. */
  listPreferenceSetDetails(options?: { readonly effectiveOnly?: boolean }): readonly PreferenceSetDetail[];
  /** Derives completion solely from current and learned Recommendation feedback versions. */
  getPreferenceLearningCompletion(recommendationId: string): PreferenceLearningCompletion | undefined;
  /** Returns idle, the oldest pending deadline, or an immediately eligible learning reason. */
  getPreferenceLearningTrigger(input: { readonly now: string }): PreferenceLearningTrigger;
  /** Captures pending feedback and group versions without acknowledging any feedback. */
  preparePreferenceLearning(input: { readonly batchId: string; readonly startedAt: string; readonly limit: number }): PreferenceLearningFacts | undefined;
  /** Validates all references before atomically writing Preferences, Evidence, and learned versions. */
  commitPreferenceLearning(input: {
    readonly facts: PreferenceLearningFacts; readonly scopes: readonly LearnedScopeInput[]; readonly committedAt: string;
  }): CommitPreferenceLearningResult;
}

/** Creates the persistence owner over the same connection used by Recommendation transactions. */
export function createPreferenceLearningRepository(database: DatabaseConnection): PreferenceLearningRepository {
  const recommendations = createRecommendationRepository(database);
  return {
    findPreferenceSetById: (id) => findSet(database, IdSchema.parse(id)),
    findPreferenceById: (id) => findPreference(database, IdSchema.parse(id)),
    findPreferenceEvidenceById: (id) => findEvidence(database, IdSchema.parse(id)),
    getPreferenceSetDetail: (id) => detail(database, IdSchema.parse(id)),
    listPreferenceSetDetails: (options = {}) => listDetails(database, recommendations, options.effectiveOnly ?? false),
    getPreferenceLearningTrigger: ({ now }) => trigger(database, TimestampSchema.parse(now)),
    preparePreferenceLearning(input) {
      const startedAt = TimestampSchema.parse(input.startedAt);
      const limit = z.number().int().min(1).max(20).parse(input.limit);
      IdSchema.parse(input.batchId);
      return database.transaction({ operation: () => prepare(database, recommendations, { ...input, startedAt, limit }) });
    },
    commitPreferenceLearning(input) {
      const committedAt = TimestampSchema.parse(input.committedAt);
      const scopes = z.array(LearnedScopeInputSchema).parse(input.scopes);
      return database.transaction({ operation: () => commit(database, recommendations, input.facts, scopes, committedAt) });
    },
    getPreferenceLearningCompletion(id) {
      const item = recommendations.findRecommendationById(id);
      if (!item?.state.reactionChangedAt) return undefined;
      const { state } = item;
      return {
        recommendationId: id,
        status: state.reactionRevision === state.learnedReactionRevision ? 'learned' : 'pending',
        currentReactionRevision: state.reactionRevision,
        learnedReactionRevision: state.learnedReactionRevision,
        changedAt: item.state.reactionChangedAt,
        preferences: listDetails(database, recommendations, false).filter(({ preferenceSet }) => (
          belongsToSet(preferenceSet, item.selectionBasis.matchedInterestIds)
        )),
      };
    },
  };
}

/** Derives the existing threshold, deadline and correction rules from persisted feedback. */
function trigger(database: DatabaseConnection, now: string): PreferenceLearningTrigger {
  const row = database.prepare<{ count: number; oldest: string | null; correction: number }>({ sql: `
    SELECT COUNT(*) AS count, MIN(reaction_changed_at) AS oldest,
      COALESCE(MAX(CASE WHEN learned_reaction_revision > 0 THEN 1 ELSE 0 END), 0) AS correction
    FROM discovery_recommendation_states WHERE reaction_revision > learned_reaction_revision
  ` }).get();
  if (!row?.count || !row.oldest) return { status: 'idle' };
  if (row.correction) return { status: 'ready', reason: 'correction', pendingReactionCount: row.count };
  if (row.count >= 3) return { status: 'ready', reason: 'threshold', pendingReactionCount: row.count };
  const dueAt = new Date(Date.parse(row.oldest) + 600_000).toISOString();
  return Date.parse(now) >= Date.parse(dueAt)
    ? { status: 'ready', reason: 'deadline', pendingReactionCount: row.count }
    : { status: 'scheduled', dueAt, pendingReactionCount: row.count };
}

/** Creates missing empty sets once, then captures all model-visible facts in one read transaction. */
function prepare(
  database: DatabaseConnection, recommendations: RecommendationRepository,
  input: { readonly batchId: string; readonly startedAt: string; readonly limit: number },
): PreferenceLearningFacts | undefined {
  const pending = recommendations.listPendingReactionChanges({ limit: input.limit });
  if (!pending.length) return undefined;
  const items = pending.map(({ recommendationId }) => {
    const item = recommendations.findRecommendationById(recommendationId);
    if (!item) throw new Error('Pending Recommendation disappeared.');
    return item;
  });
  const setIds = new Set<string>();
  for (const item of items) {
    const ids = item.selectionBasis.matchedInterestIds;
    if (!ids.length) setIds.add(ensureSet(database, undefined, input.startedAt));
    for (const interestId of ids) {
      if (validInterest(database, interestId)) setIds.add(ensureSet(database, interestId, input.startedAt));
    }
  }
  const currentPreferences = [...setIds].sort().map((id) => {
    const value = detail(database, id);
    if (!value) throw new Error('Prepared Preference Set disappeared.');
    return value;
  });
  const supports = new Map<string, PreferenceLearningSupport>();
  for (const group of currentPreferences) for (const entry of group.preferences) for (const evidence of entry.evidence) {
    const item = recommendations.findRecommendationById(evidence.recommendationId);
    if (item && evidenceIsCurrent(evidence, item)) supports.set(item.id, support(item));
  }
  for (const item of items) if (item.state.reaction) supports.set(item.id, support(item));
  return {
    batch: { batchId: input.batchId, startedAt: input.startedAt, changeCount: items.length },
    currentPreferences,
    supportingReactions: [...supports.values()],
    reactionChanges: items.map((item) => ({
      recommendationId: item.id,
      learnedReaction: item.state.learnedReaction,
      learnedReactionRevision: item.state.learnedReactionRevision,
      currentReaction: item.state.reaction,
      currentReactionRevision: item.state.reactionRevision,
      changedAt: item.state.reactionChangedAt ?? input.startedAt,
      requiresCorrection: item.state.learnedReactionRevision > 0,
      previouslySupportedPreferenceIds: database.prepare<{ preference_id: string }>({
        sql: 'SELECT preference_id FROM discovery_preference_evidence WHERE recommendation_id = ? ORDER BY preference_id',
      }).all([item.id]).map((row) => row.preference_id),
      recommendation: {
        title: item.content.title, sourceName: item.content.sourceName,
        author: item.content.author, contentType: item.content.contentType,
        publishedAt: item.content.contentPublishedAt ?? item.publishedAt,
        recommendationReason: item.recommendationReason,
        matchedInterestIds: item.selectionBasis.matchedInterestIds,
        contentEvidence: {
          sourceId: item.content.sourceId, canonicalUrl: item.content.canonicalUrl,
          title: item.content.title, contentSummary: item.content.contentSummary,
          description: item.content.description, contentText: item.content.contentExcerpt,
          completeness: item.content.contentExcerpt ? item.content.contentTruncated ? 'partial' : 'full' : 'metadata_only',
        },
      },
    })),
  };
}

/** Runs all checks before the first mutation, with CAS on both groups and feedback acknowledgements. */
function commit(
  database: DatabaseConnection, recommendations: RecommendationRepository,
  facts: PreferenceLearningFacts, scopes: readonly LearnedScopeInput[], now: string,
): CommitPreferenceLearningResult {
  const reject = (reason: Extract<CommitPreferenceLearningResult, { status: 'rejected' }>['reason']): CommitPreferenceLearningResult => ({ status: 'rejected', reason });
  const setIds = facts.currentPreferences.map(({ preferenceSet }) => preferenceSet.id);
  if (scopes.length !== setIds.length || new Set(scopes.map((scope) => scope.preferenceSetId)).size !== setIds.length
    || scopes.some((scope) => !setIds.includes(scope.preferenceSetId))) return reject('scope_mismatch');
  for (const change of facts.reactionChanges) {
    const item = recommendations.findRecommendationById(change.recommendationId);
    if (!item || item.state.reactionRevision !== change.currentReactionRevision
      || item.state.learnedReactionRevision !== change.learnedReactionRevision) return reject('revision_conflict');
  }
  const allIds = scopes.flatMap((scope) => scope.preferences.map(({ id }) => id));
  if (new Set(allIds).size !== allIds.length) return reject('invalid_preference_reference');
  for (const scope of scopes) {
    const captured = facts.currentPreferences.find(({ preferenceSet }) => preferenceSet.id === scope.preferenceSetId);
    const current = findSet(database, scope.preferenceSetId);
    if (!captured || !current || scope.baseRevision !== captured.preferenceSet.revision
      || current.revision !== scope.baseRevision) return reject('revision_conflict');
    if (current.interestId && !validInterest(database, current.interestId)) return reject('invalid_interest_reference');
    for (const preference of scope.preferences) {
      const owner = findPreference(database, preference.id);
      if (owner && owner.preferenceSetId !== current.id) return reject('invalid_preference_reference');
      if (new Set(preference.supportingRecommendationIds).size !== preference.supportingRecommendationIds.length) return reject('invalid_recommendation_reference');
      for (const id of preference.supportingRecommendationIds) {
        const allowed = facts.supportingReactions.find((item) => item.recommendationId === id);
        const item = recommendations.findRecommendationById(id);
        if (!allowed || !item || !belongsToSet(current, allowed.matchedInterestIds)
          || item.state.reactionRevision !== allowed.reactionRevision || item.state.reaction !== allowed.reaction) {
          return reject('invalid_recommendation_reference');
        }
      }
    }
  }
  const revisions: Array<{ preferenceSetId: string; revision: number }> = [];
  for (const scope of scopes) {
    updateSet(database, scope, facts.supportingReactions, now);
    revisions.push({ preferenceSetId: scope.preferenceSetId, revision: scope.baseRevision + 1 });
  }
  for (const change of facts.reactionChanges) {
    const result = recommendations.acknowledgeReactionLearned({
      recommendationId: change.recommendationId, expectedReactionRevision: change.currentReactionRevision,
      learnedReaction: change.currentReaction ?? null,
    });
    if (result.status !== 'acknowledged') throw new Error('Feedback acknowledgement changed inside the transaction.');
  }
  return {
    status: 'committed', revisions,
    affectedInterestIds: facts.currentPreferences.flatMap(({ preferenceSet }) => preferenceSet.interestId ? [preferenceSet.interestId] : []),
  };
}

/** Applies a full next set without changing identities of surviving Preferences or Evidence pairs. */
function updateSet(database: DatabaseConnection, scope: LearnedScopeInput, supports: readonly PreferenceLearningSupport[], now: string): void {
  const surviving = new Set(scope.preferences.map(({ id }) => id));
  for (const row of database.prepare<{ id: string }>({ sql: 'SELECT id FROM discovery_preferences WHERE preference_set_id = ?' }).all([scope.preferenceSetId])) {
    if (!surviving.has(row.id)) database.prepare({ sql: 'DELETE FROM discovery_preferences WHERE id = ?' }).run([row.id]);
  }
  for (const preference of scope.preferences) {
    database.prepare({ sql: `
      INSERT INTO discovery_preferences (id, preference_set_id, polarity, dimension, statement, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET polarity=excluded.polarity, dimension=excluded.dimension,
        statement=excluded.statement, updated_at=excluded.updated_at
    ` }).run([preference.id, scope.preferenceSetId, preference.polarity, preference.dimension, preference.statement, now, now]);
    for (const row of evidenceFor(database, preference.id)) {
      if (!preference.supportingRecommendationIds.includes(row.recommendationId)) {
        database.prepare({ sql: 'DELETE FROM discovery_preference_evidence WHERE id = ?' }).run([row.id]);
      }
    }
    for (const id of preference.supportingRecommendationIds) {
      const fact = supports.find((item) => item.recommendationId === id);
      if (!fact) throw new Error('Validated support disappeared.');
      database.prepare({ sql: `
        INSERT INTO discovery_preference_evidence (id, preference_id, recommendation_id, reaction_revision, reaction, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(preference_id, recommendation_id) DO UPDATE SET
          reaction_revision=excluded.reaction_revision, reaction=excluded.reaction
      ` }).run([randomUUID(), preference.id, id, fact.reactionRevision, fact.reaction, now]);
    }
  }
  const result = database.prepare({ sql: `
    UPDATE discovery_preference_sets SET revision=revision+1, updated_at=? WHERE id=? AND revision=?
  ` }).run([now, scope.preferenceSetId, scope.baseRevision]);
  if (result.changes !== 1) throw new Error('Preference version changed inside the transaction.');
}

/** Reuses the unique business scope or creates its durable database identity once. */
function ensureSet(database: DatabaseConnection, interestId: string | undefined, now: string): string {
  const existing = database.prepare<{ id: string }>({ sql: interestId
    ? 'SELECT id FROM discovery_preference_sets WHERE interest_id = ?'
    : "SELECT id FROM discovery_preference_sets WHERE scope = 'exploration'",
  }).get(interestId ? [interestId] : []);
  if (existing) return existing.id;
  const id = randomUUID();
  database.prepare({ sql: `
    INSERT INTO discovery_preference_sets (id, scope, interest_id, revision, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?)
  ` }).run([id, interestId ? 'interest' : 'exploration', interestId ?? null, now, now]);
  return id;
}

function findSet(database: DatabaseConnection, id: string): PreferenceSet | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preference_sets WHERE id = ?' }).get([id]);
  return row ? PreferenceSetSchema.parse({
    id: row.id, scope: row.scope, interestId: row.interest_id ?? undefined,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  }) : undefined;
}
function findPreference(database: DatabaseConnection, id: string): Preference | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preferences WHERE id = ?' }).get([id]);
  return row ? PreferenceSchema.parse({
    id: row.id, preferenceSetId: row.preference_set_id, polarity: row.polarity,
    dimension: row.dimension, statement: row.statement, createdAt: row.created_at, updatedAt: row.updated_at,
  }) : undefined;
}
function findEvidence(database: DatabaseConnection, id: string): PreferenceEvidence | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preference_evidence WHERE id = ?' }).get([id]);
  return row ? PreferenceEvidenceSchema.parse({
    id: row.id, preferenceId: row.preference_id, recommendationId: row.recommendation_id,
    reactionRevision: row.reaction_revision, reaction: row.reaction, createdAt: row.created_at,
  }) : undefined;
}
function evidenceFor(database: DatabaseConnection, id: string): PreferenceEvidence[] {
  return database.prepare<{ id: string }>({ sql: 'SELECT id FROM discovery_preference_evidence WHERE preference_id = ? ORDER BY id' })
    .all([id]).map((row) => {
      const value = findEvidence(database, row.id);
      if (!value) throw new Error('Preference Evidence disappeared.');
      return value;
    });
}
/** Joins the group with its independently addressable Preferences and Evidence. */
function detail(database: DatabaseConnection, id: string): PreferenceSetDetail | undefined {
  const preferenceSet = findSet(database, id);
  if (!preferenceSet) return undefined;
  const preferences = database.prepare<{ id: string }>({ sql: 'SELECT id FROM discovery_preferences WHERE preference_set_id = ? ORDER BY created_at, id' })
    .all([id]).map((row) => {
      const preference = findPreference(database, row.id);
      if (!preference) throw new Error('Preference disappeared.');
      return { preference, evidence: evidenceFor(database, row.id) };
    });
  return { preferenceSet, preferences };
}
/** Filters stale support only for future recommendation input; stored evidence remains queryable. */
function listDetails(database: DatabaseConnection, recommendations: RecommendationRepository, effectiveOnly: boolean): PreferenceSetDetail[] {
  return database.prepare<{ id: string }>({ sql: 'SELECT id FROM discovery_preference_sets ORDER BY created_at, id' }).all().flatMap(({ id }) => {
    const value = detail(database, id);
    if (!value) return [];
    if (!effectiveOnly) return [value];
    if (value.preferenceSet.interestId && !validInterest(database, value.preferenceSet.interestId)) return [];
    return [{
      preferenceSet: value.preferenceSet,
      preferences: value.preferences.flatMap((entry) => {
        const evidence = entry.evidence.filter((item) => {
          const recommendation = recommendations.findRecommendationById(item.recommendationId);
          return recommendation && evidenceIsCurrent(item, recommendation);
        });
        return evidence.length ? [{ preference: entry.preference, evidence }] : [];
      }),
    }];
  });
}
function evidenceIsCurrent(evidence: PreferenceEvidence, recommendation: Recommendation): boolean {
  return evidence.reactionRevision === recommendation.state.reactionRevision && evidence.reaction === recommendation.state.reaction;
}
function belongsToSet(set: PreferenceSet, matchedInterestIds: readonly string[]): boolean {
  return set.scope === 'interest' ? Boolean(set.interestId && matchedInterestIds.includes(set.interestId)) : matchedInterestIds.length === 0;
}
function validInterest(database: DatabaseConnection, id: string): boolean {
  return Boolean(database.prepare({ sql: "SELECT id FROM discovery_interests WHERE id=? AND status <> 'deleted'" }).get([id]));
}
function support(item: Recommendation): PreferenceLearningSupport {
  if (!item.state.reaction) throw new Error('Support requires a current Reaction.');
  return { recommendationId: item.id, reactionRevision: item.state.reactionRevision, reaction: item.state.reaction, matchedInterestIds: item.selectionBasis.matchedInterestIds };
}
