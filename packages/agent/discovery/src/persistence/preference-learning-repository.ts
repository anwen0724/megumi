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
  type LearnedScopeInput, type PreferenceLearningFacts,
  type PreferenceLearningCompletion, type CommitPreferenceLearningResult,
  type PreferenceLearningSupport,
  PreferenceScopeRequestSchema, type PreferenceScopeRequest, type PreferenceManagementDetails, type PreferenceEvidenceView,
} from '../preferences/preference';
import { createRecommendationRepository, type RecommendationRepository } from './recommendation-repository';
import { createInterestRepository } from './interest-repository';
import type { Recommendation } from '../recommendation/recommendation';
import { changePreferenceInputs, ensurePreferenceSet, readPreferenceGuard } from './preference-input-state';

const TimestampSchema = z.string().datetime({ offset: true });
const IdSchema = z.string().min(1);

export interface PreferenceLearningRepository {
  /** Captures current publication guard versions without invoking learning. */
  /** Reads effective scoped preferences and their publication guard in one transaction. */
  getEffectivePreferences(scopes?: readonly PreferenceScopeRequest[]): { readonly preferences: readonly PreferenceSetDetail[]; readonly guard: import('../preferences/preference').PreferenceGuard };
  getPreferenceGuard(): import('../preferences/preference').PreferenceGuard;
  /** Reads current visible preferences without creating scopes or invoking a model. */
  getPreferenceDetails(scope: PreferenceScopeRequest): PreferenceManagementDetails | undefined;
  /** Distinguishes current feedback from the original inferred relationship. */
  getPreferenceEvidence(preferenceId: string): PreferenceEvidenceView | undefined;
  /** Promotes a learned statement to an explicit, user-owned requirement under CAS. */
  editPreference(input: { readonly preferenceId: string; readonly expectedRevision: number; readonly statement: string; readonly now: string }): PreferenceEditResult;
  /** Retains the deletion boundary while immediately removing the preference from effective reads. */
  deletePreference(input: { readonly preferenceId: string; readonly expectedRevision: number; readonly now: string }): PreferenceDeleteResult;
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
  /** Captures pending feedback and group versions without acknowledging any feedback. */
  preparePreferenceLearning(input: { readonly batchId: string; readonly startedAt: string; readonly limit: number; readonly preferenceSetId?: string }): PreferenceLearningFacts | undefined;
  /** Validates all references before atomically writing Preferences, Evidence, and learned versions. */
  commitPreferenceLearning(input: {
    readonly facts: PreferenceLearningFacts; readonly scopes: readonly LearnedScopeInput[]; readonly committedAt: string;
  }): CommitPreferenceLearningResult;
}

export type PreferenceEditResult = { readonly status: 'updated' | 'unchanged'; readonly preference: Preference }
  | { readonly status: 'not_found' | 'revision_conflict' | 'invalid_input' };
export type PreferenceDeleteResult = { readonly status: 'deleted' | 'already_deleted' | 'not_found' | 'revision_conflict' };

/** Creates the persistence owner over the same connection used by Recommendation transactions. */
export function createPreferenceLearningRepository(database: DatabaseConnection): PreferenceLearningRepository {
  const recommendations = createRecommendationRepository(database);
  return {
    getEffectivePreferences(scopes) {
      const parsed = scopes ? z.array(PreferenceScopeRequestSchema).parse(scopes) : undefined;
      return database.transaction({ operation: () => ({
        preferences: listDetails(database, recommendations, true).filter(({ preferenceSet }) => !parsed || parsed.some((scope) => scope.scope === preferenceSet.scope && (scope.scope === 'exploration' || scope.interestId === preferenceSet.interestId))),
        guard: readPreferenceGuard(database),
      }) });
    },
    getPreferenceGuard: () => readPreferenceGuard(database),
    getPreferenceDetails(rawScope) {
      const scope = PreferenceScopeRequestSchema.parse(rawScope);
      const interest = scope.scope === 'interest'
        ? database.prepare<{ status: string }>({ sql: "SELECT status FROM discovery_interests WHERE id=? AND status<>'deleted'" }).get([scope.interestId]) : undefined;
      if (scope.scope === 'interest' && !interest) return undefined;
      const group = listDetails(database, recommendations, false).find(({ preferenceSet }) => scope.scope === 'interest'
        ? preferenceSet.interestId === scope.interestId : preferenceSet.scope === 'exploration');
      return {
        scope, hasPendingLearning: !!group && group.preferenceSet.processedRevision !== group.preferenceSet.revision,
        preferences: group?.preferences.filter(({ preference }) => preference.status === 'active' || preference.status === 'needs_review').map(({ preference }) => ({
          preference, validity: interest?.status === 'paused' ? 'interest_paused' : preference.status === 'needs_review' ? 'needs_review' : 'effective',
        })) ?? [],
      };
    },
    getPreferenceEvidence(preferenceId) {
      const preference = findPreference(database, IdSchema.parse(preferenceId));
      if (!preference || preference.status === 'deleted') return undefined;
      return { preferenceId, historicalSourceOnly: preference.origin === 'user', evidence: evidenceFor(database, preferenceId).map((reference) => {
        const item = recommendations.findRecommendationById(reference.recommendationId);
        if (!item) throw new Error('Preference evidence has no Recommendation.');
        return {
          reference, title: item.content.title, sourceName: item.content.sourceName, canonicalUrl: item.content.canonicalUrl,
          currentReaction: item.state.reaction, currentReactionRevision: item.state.reactionRevision,
          current: evidenceIsCurrent(reference, item),
          content: { sourceId: item.content.sourceId, canonicalUrl: item.content.canonicalUrl, title: item.content.title,
            contentSummary: item.content.contentSummary, ...(item.content.description ? { description: item.content.description } : {}), ...(item.content.contentExcerpt ? { contentText: [...item.content.contentExcerpt].slice(0, 2000).join('') } : {}),
            completeness: item.content.contentExcerpt ? (item.content.contentTruncated || [...item.content.contentExcerpt].length > 2000) ? 'partial' : 'full' : 'metadata_only' },
        };
      }) };
    },
    editPreference(input) {
      const statement = input.statement.trim();
      if ([...statement].length < 1 || [...statement].length > 1000) return { status: 'invalid_input' };
      const now = TimestampSchema.parse(input.now);
      return database.transaction({ operation: (): PreferenceEditResult => {
        const current = findPreference(database, input.preferenceId);
        if (!current || current.status === 'deleted' || !editableSet(database, current.preferenceSetId)) return { status: 'not_found' };
        if (current.revision !== input.expectedRevision) return { status: 'revision_conflict' };
        if (current.origin === 'user' && current.statement === statement) return { status: 'unchanged', preference: current };
        database.prepare({ sql: "UPDATE discovery_preferences SET origin='user',polarity=NULL,dimension=NULL,statement=?,status='active',user_edited_at=?,updated_at=?,revision=revision+1 WHERE id=?" }).run([statement, now, now, current.id]);
        changePreferenceInputs(database, current.preferenceSetId, now, true, true);
        const preference = findPreference(database, current.id);
        if (!preference) throw new Error('Edited preference disappeared.');
        return { status: 'updated', preference };
      } });
    },
    deletePreference(input) {
      const now = TimestampSchema.parse(input.now);
      return database.transaction({ operation: (): PreferenceDeleteResult => {
        const current = findPreference(database, input.preferenceId);
        if (!current || !editableSet(database, current.preferenceSetId)) return { status: 'not_found' };
        if (current.status === 'deleted') return { status: 'already_deleted' };
        if (current.revision !== input.expectedRevision) return { status: 'revision_conflict' };
        database.prepare({ sql: `UPDATE discovery_preferences SET status='deleted',deleted_at=?,updated_at=?,revision=revision+1,
          deleted_feedback_sequence=(SELECT COALESCE(MAX(reaction_sequence),0) FROM discovery_recommendation_states) WHERE id=?` }).run([now, now, current.id]);
        changePreferenceInputs(database, current.preferenceSetId, now, true, true);
        return { status: 'deleted' };
      } });
    },
    findPreferenceSetById: (id) => findSet(database, IdSchema.parse(id)),
    findPreferenceById: (id) => findPreference(database, IdSchema.parse(id)),
    findPreferenceEvidenceById: (id) => findEvidence(database, IdSchema.parse(id)),
    getPreferenceSetDetail: (id) => detail(database, IdSchema.parse(id)),
    listPreferenceSetDetails: (options = {}) => listDetails(database, recommendations, options.effectiveOnly ?? false),
    preparePreferenceLearning(input) {
      const startedAt = TimestampSchema.parse(input.startedAt);
      const limit = z.number().int().positive().parse(input.limit);
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

/** Creates missing empty sets once, then captures all model-visible facts in one read transaction. */
function prepare(
  database: DatabaseConnection, recommendations: RecommendationRepository,
  input: { readonly batchId: string; readonly startedAt: string; readonly limit: number; readonly preferenceSetId?: string },
): PreferenceLearningFacts | undefined {
  for (const row of database.prepare<{ id: string }>({ sql: "SELECT id FROM discovery_interests WHERE status='active'" }).all()) ensurePreferenceSet(database, row.id, input.startedAt);
  const currentPreferences = listDetails(database, recommendations, false).filter(({ preferenceSet }) => {
    if (input.preferenceSetId && preferenceSet.id !== input.preferenceSetId) return false;
    if (preferenceSet.processedRevision === preferenceSet.revision) return false;
    return !preferenceSet.interestId || database.prepare({ sql: "SELECT id FROM discovery_interests WHERE id=? AND status='active'" }).get([preferenceSet.interestId]);
  });
  if (!currentPreferences.length) return undefined;
  const itemsById = new Map<string, Recommendation>();
  const all = database.prepare<{ id: string }>({ sql: 'SELECT r.id FROM discovery_recommendations r JOIN discovery_recommendation_states s ON s.recommendation_id=r.id WHERE s.reaction_revision>0 ORDER BY s.reaction_sequence DESC,r.id' }).all().map(({ id }) => {
    const item = recommendations.findRecommendationById(id);
    if (!item) throw new Error('Feedback Recommendation disappeared.');
    return item;
  });
  for (const group of currentPreferences) {
    const scoped = all.filter((item) => belongsToSet(group.preferenceSet, item.selectionBasis.matchedInterestIds));
    for (const item of scoped.filter((item) => item.state.reactionRevision > item.state.learnedReactionRevision)) itemsById.set(item.id, item);
    for (const item of scoped.filter((item) => item.state.reaction).slice(0, 30)) itemsById.set(item.id, item);
    for (const entry of group.preferences) for (const evidence of entry.evidence) {
      const item = recommendations.findRecommendationById(evidence.recommendationId);
      if (!item) throw new Error('Preference evidence lost its Recommendation.');
      itemsById.set(item.id, item);
    }
  }
  const items = [...itemsById.values()];
  const supports = new Map<string, PreferenceLearningSupport>();
  for (const group of currentPreferences) for (const entry of group.preferences) for (const evidence of entry.evidence) {
    const item = recommendations.findRecommendationById(evidence.recommendationId);
    if (item && evidenceIsCurrent(evidence, item)) supports.set(item.id, support(item));
  }
  for (const item of items) if (item.state.reaction) supports.set(item.id, support(item));
  return {
    batch: { batchId: input.batchId, startedAt: input.startedAt, changeCount: items.length },
    currentPreferences,
    interests: createInterestRepository(database).listInterestsByIds(currentPreferences.flatMap(({ preferenceSet }) => preferenceSet.interestId ? [preferenceSet.interestId] : [])),
    reviewedPreferenceIds: currentPreferences.flatMap(({ preferences }) => preferences.filter(({ preference }) => preference.origin === 'learned' && preference.status !== 'deleted').map(({ preference }) => preference.id)),
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
          ...(item.content.description ? { description: item.content.description } : {}), ...(item.content.contentExcerpt ? { contentText: [...item.content.contentExcerpt].slice(0, 2000).join('') } : {}),
          completeness: item.content.contentExcerpt ? (item.content.contentTruncated || [...item.content.contentExcerpt].length > 2000) ? 'partial' : 'full' : 'metadata_only',
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
  for (const scope of scopes) {
    const captured = facts.currentPreferences.find(({ preferenceSet }) => preferenceSet.id === scope.preferenceSetId);
    const current = findSet(database, scope.preferenceSetId);
    if (!captured || !current || scope.baseRevision !== captured.preferenceSet.revision || current.revision !== scope.baseRevision) return reject('revision_conflict');
    if (current.interestId && !database.prepare({ sql: "SELECT id FROM discovery_interests WHERE id=? AND status='active'" }).get([current.interestId])) return reject('invalid_interest_reference');
    const expected = captured.preferences.filter(({ preference }) => preference.origin === 'learned' && preference.status !== 'deleted').map(({ preference }) => preference.id).sort();
    if (JSON.stringify([...scope.reviewedPreferenceIds].sort()) !== JSON.stringify(expected)) return reject('invalid_preference_reference');
    if ((scope.changes.length > 0) !== (scope.outcome === 'changed')) return reject('invalid_preference_reference');
    const modified = new Set<string>();
    for (const change of scope.changes) {
      if (change.kind !== 'add') {
        const owner = captured.preferences.find(({ preference }) => preference.id === change.preferenceId)?.preference;
        if (!owner || owner.origin !== 'learned' || owner.status === 'deleted' || owner.revision !== change.expectedRevision || modified.has(owner.id)) return reject('invalid_preference_reference');
        modified.add(owner.id);
      }
      if (change.kind === 'retire') continue;
      if (!change.evidence.some((item) => item.relation === 'support') || new Set(change.evidence.map((item) => item.recommendationId)).size !== change.evidence.length) return reject('invalid_recommendation_reference');
      for (const reference of change.evidence) {
        const allowed = facts.supportingReactions.find((item) => item.recommendationId === reference.recommendationId);
        const item = recommendations.findRecommendationById(reference.recommendationId);
        if (!allowed || !item || !belongsToSet(current, allowed.matchedInterestIds) || item.state.reactionRevision !== allowed.reactionRevision || item.state.reaction !== allowed.reaction) return reject('invalid_recommendation_reference');
        const evidence = facts.reactionChanges.find((item) => item.recommendationId === reference.recommendationId)?.recommendation.contentEvidence;
        if (reference.contentQuote && ![evidence?.contentText, evidence?.description, evidence?.contentSummary].some((text) => text?.includes(reference.contentQuote ?? ''))) return reject('invalid_recommendation_reference');
      }
      const deleted = captured.preferences.filter(({ preference }) => preference.status === 'deleted' && (preference.statement.normalize('NFKC').trim() === change.statement.normalize('NFKC').trim() || (change.kind === 'add' && preference.id === change.deletedPreferenceId)));
      if (change.kind === 'add' && change.deletedPreferenceId && !deleted.some(({ preference }) => preference.id === change.deletedPreferenceId)) return reject('invalid_preference_reference');
      for (const { preference } of deleted) if (!change.evidence.some((reference) => reference.relation === 'support' && facts.supportingReactions.some((fact) => fact.recommendationId === reference.recommendationId && fact.reactionSequence > (preference.deletedFeedbackSequence ?? Number.MAX_SAFE_INTEGER)))) return reject('invalid_recommendation_reference');
    }
    if (captured.preferences.some(({ preference }) => preference.status === 'needs_review' && !modified.has(preference.id))) return reject('invalid_preference_reference');
  }
  const revisions: Array<{ preferenceSetId: string; revision: number }> = [];
  for (const scope of scopes) {
    updateSet(database, scope, facts.supportingReactions, now);
    revisions.push({ preferenceSetId: scope.preferenceSetId, revision: scope.baseRevision + 1 });
  }
  for (const change of facts.reactionChanges) {
    const item = recommendations.findRecommendationById(change.recommendationId);
    if (!item || item.state.reactionRevision === item.state.learnedReactionRevision) continue;
    const related = listDetails(database, recommendations, false).filter(({ preferenceSet }) => belongsToSet(preferenceSet, item.selectionBasis.matchedInterestIds));
    if (related.some(({ preferenceSet }) => preferenceSet.processedRevision !== preferenceSet.revision)) continue;
    const result = recommendations.acknowledgeReactionLearned({ recommendationId: change.recommendationId, expectedReactionRevision: change.currentReactionRevision, learnedReaction: change.currentReaction ?? null });
    if (result.status !== 'acknowledged') throw new Error('Feedback changed inside learning commit.');
  }
  return {
    status: 'committed', revisions,
    affectedInterestIds: facts.currentPreferences.flatMap(({ preferenceSet }) => preferenceSet.interestId ? [preferenceSet.interestId] : []),
  };
}

/** Applies explicit changes only; omitted preferences keep their identity and meaning. */
function updateSet(database: DatabaseConnection, scope: LearnedScopeInput, supports: readonly PreferenceLearningSupport[], now: string): void {
  for (const change of scope.changes) {
    if (change.kind === 'retire') {
      database.prepare({ sql: "UPDATE discovery_preferences SET status='retired',revision=revision+1,updated_at=? WHERE id=?" }).run([now, change.preferenceId]);
      continue;
    }
    const id = change.kind === 'add' ? randomUUID() : change.preferenceId;
    if (change.kind === 'add') database.prepare({ sql: "INSERT INTO discovery_preferences (id,preference_set_id,origin,polarity,dimension,statement,status,created_at,updated_at) VALUES (?,?,'learned',?,?,?,'active',?,?)" }).run([id, scope.preferenceSetId, change.polarity, change.dimension, change.statement, now, now]);
    else database.prepare({ sql: "UPDATE discovery_preferences SET polarity=?,dimension=?,statement=?,status='active',revision=revision+1,updated_at=? WHERE id=?" }).run([change.polarity, change.dimension, change.statement, now, id]);
    for (const old of evidenceFor(database, id)) if (!change.evidence.some((reference) => reference.recommendationId === old.recommendationId)) database.prepare({ sql: 'DELETE FROM discovery_preference_evidence WHERE id=?' }).run([old.id]);
    for (const reference of change.evidence) {
      const fact = supports.find((item) => item.recommendationId === reference.recommendationId);
      if (!fact) throw new Error('Validated support disappeared.');
      database.prepare({ sql: `INSERT INTO discovery_preference_evidence (id,preference_id,recommendation_id,reaction_revision,reaction,relation,explanation,content_quote,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(preference_id,recommendation_id) DO UPDATE SET reaction_revision=excluded.reaction_revision,reaction=excluded.reaction,relation=excluded.relation,explanation=excluded.explanation,content_quote=excluded.content_quote,updated_at=excluded.updated_at` })
        .run([randomUUID(), id, reference.recommendationId, fact.reactionRevision, fact.reaction, reference.relation, reference.explanation, reference.contentQuote ?? null, now, now]);
    }
  }
  database.prepare({ sql: 'UPDATE discovery_preference_sets SET processed_revision=revision+1,revision=revision+1,last_outcome=?,updated_at=? WHERE id=? AND revision=?' }).run([scope.outcome, now, scope.preferenceSetId, scope.baseRevision]);
}

function findSet(database: DatabaseConnection, id: string): PreferenceSet | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preference_sets WHERE id = ?' }).get([id]);
  return row ? PreferenceSetSchema.parse({
    id: row.id, scope: row.scope, ...(row.interest_id !== null ? { interestId: row.interest_id } : {}),
    revision: row.revision, ...(row.processed_revision !== null ? { processedRevision: row.processed_revision } : {}),
    policyRevision: row.policy_revision, ...(row.last_outcome !== null ? { lastOutcome: row.last_outcome } : {}),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }) : undefined;
}
function findPreference(database: DatabaseConnection, id: string): Preference | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preferences WHERE id = ?' }).get([id]);
  return row ? PreferenceSchema.parse({
    id: row.id, preferenceSetId: row.preference_set_id, ...(row.polarity !== null ? { polarity: row.polarity } : {}),
    ...(row.dimension !== null ? { dimension: row.dimension } : {}), statement: row.statement, createdAt: row.created_at, updatedAt: row.updated_at,
    origin: row.origin, revision: row.revision, status: row.status,
    ...(row.user_edited_at !== null ? { userEditedAt: row.user_edited_at } : {}), ...(row.deleted_at !== null ? { deletedAt: row.deleted_at } : {}),
    ...(row.deleted_feedback_sequence !== null ? { deletedFeedbackSequence: row.deleted_feedback_sequence } : {}),
  }) : undefined;
}
function findEvidence(database: DatabaseConnection, id: string): PreferenceEvidence | undefined {
  const row = database.prepare<DatabaseRow>({ sql: 'SELECT * FROM discovery_preference_evidence WHERE id = ?' }).get([id]);
  return row ? PreferenceEvidenceSchema.parse({
    id: row.id, preferenceId: row.preference_id, recommendationId: row.recommendation_id,
    reactionRevision: row.reaction_revision, reaction: row.reaction, createdAt: row.created_at,
    relation: row.relation, ...(row.explanation !== null ? { explanation: row.explanation } : {}),
    ...(row.content_quote !== null ? { contentQuote: row.content_quote } : {}), updatedAt: row.updated_at,
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
    if (value.preferenceSet.interestId && !database.prepare({ sql: "SELECT id FROM discovery_interests WHERE id=? AND status='active'" }).get([value.preferenceSet.interestId])) return [];
    return [{
      preferenceSet: value.preferenceSet,
      preferences: value.preferences.flatMap((entry) => {
        if (entry.preference.status !== 'active') return [];
        if (entry.preference.origin === 'user') return [entry];
        const evidence = entry.evidence.filter((item) => {
          const recommendation = recommendations.findRecommendationById(item.recommendationId);
          return recommendation && evidenceIsCurrent(item, recommendation);
        });
        return evidence.length === entry.evidence.length && evidence.some((item) => item.relation === 'support') ? [{ preference: entry.preference, evidence }] : [];
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
/** Deleted interests cannot accept new user edits, while paused interests remain manageable. */
function editableSet(database: DatabaseConnection, id: string): boolean {
  const set = findSet(database, id);
  return !!set && (!set.interestId || validInterest(database, set.interestId));
}
function support(item: Recommendation): PreferenceLearningSupport {
  if (!item.state.reaction) throw new Error('Support requires a current Reaction.');
  return { recommendationId: item.id, reactionRevision: item.state.reactionRevision, reactionSequence: item.state.reactionSequence, reaction: item.state.reaction, matchedInterestIds: item.selectionBasis.matchedInterestIds };
}
