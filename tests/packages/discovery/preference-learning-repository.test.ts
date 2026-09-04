/*
 * Verifies durable Preference identity, valid support and atomic feedback-version commits.
 */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import type { DatabaseConnection } from '@megumi/database';
import type { DiscoveryRepository, LearnedScopeInput, PreferenceLearningFacts } from '@megumi/discovery';
import { createLearningFixture, now, seedRecommendation, setReaction } from './preference-learning-fixtures';

const databases: DatabaseConnection[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function setup() { const value = createLearningFixture(); databases.push(value.database); return value; }
function prepare(repository: DiscoveryRepository): PreferenceLearningFacts {
  const facts = repository.preparePreferenceLearning({ batchId: 'work:1', startedAt: now, limit: 20 });
  if (!facts) throw new Error('Expected pending feedback.');
  return facts;
}
function scope(facts: PreferenceLearningFacts, supportingRecommendationIds = ['recommendation:1']): LearnedScopeInput {
  const set = facts.currentPreferences[0].preferenceSet;
  return { preferenceSetId: set.id, baseRevision: set.revision, preferences: [{
    id: 'preference:1', polarity: 'positive', dimension: 'topic',
    statement: '更关注 Agent 工程实现。', supportingRecommendationIds,
  }] };
}
function learn(repository: DiscoveryRepository) {
  const facts = prepare(repository);
  const result = repository.commitPreferenceLearning({ facts, committedAt: now, scopes: [scope(facts)] });
  expect(result.status).toBe('committed');
  return facts.currentPreferences[0].preferenceSet.id;
}

describe('Preference learning repository', () => {
  it('prepares real set identities and publishes versioned evidence', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    const facts = prepare(repository);
    const set = facts.currentPreferences[0].preferenceSet;
    expect(set.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(set.revision).toBe(0);
    expect(facts.reactionChanges[0].recommendation.contentEvidence.contentSummary).toBe('Summary 1');
    learn(repository);
    const detail = repository.getPreferenceSetDetail(set.id);
    expect(detail?.preferenceSet.revision).toBe(1);
    const entry = detail?.preferences[0];
    expect(entry?.preference.id).toBe('preference:1');
    const evidence = entry?.evidence[0];
    expect(evidence).toMatchObject({
      id: expect.any(String), preferenceId: 'preference:1',
      recommendationId: 'recommendation:1', reactionRevision: 1, reaction: 'liked',
    });
    if (!evidence) throw new Error('Expected durable evidence.');
    expect(repository.findPreferenceSetById(set.id)).toEqual(detail?.preferenceSet);
    expect(repository.findPreferenceById('preference:1')).toEqual(entry?.preference);
    expect(repository.findPreferenceEvidenceById(evidence.id)).toEqual(evidence);
    expect(repository.getPreferenceLearningCompletion('recommendation:1')).toMatchObject({
      status: 'learned', currentReactionRevision: 1, learnedReactionRevision: 1,
    });
    expect(repository.findPreferenceById('missing')).toBeUndefined();
  });

  it('keeps surviving Preference and Evidence identities across corrections', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    const id = learn(repository);
    const original = repository.getPreferenceSetDetail(id)?.preferences[0];
    setReaction(database, 1, 'disliked', '2026-08-27T09:00:00.000Z');
    const facts = prepare(repository);
    expect(facts.reactionChanges[0].previouslySupportedPreferenceIds).toEqual(['preference:1']);
    const updated = scope(facts);
    expect(repository.commitPreferenceLearning({
      facts, scopes: [{ ...updated, preferences: updated.preferences.map((value) => ({ ...value, polarity: 'negative' })) }],
      committedAt: '2026-08-27T10:00:00.000Z',
    }).status).toBe('committed');
    const entry = repository.getPreferenceSetDetail(id)?.preferences[0];
    expect(entry?.preference).toMatchObject({
      id: original?.preference.id, createdAt: original?.preference.createdAt,
      polarity: 'negative', updatedAt: '2026-08-27T10:00:00.000Z',
    });
    expect(entry?.evidence[0]).toMatchObject({
      id: original?.evidence[0].id, createdAt: original?.evidence[0].createdAt,
      reaction: 'disliked', reactionRevision: 2,
    });
  });

  it('hides revoked support from new recommendations and removes it on correction', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    const id = learn(repository);
    setReaction(database, 1, null);
    expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences).toEqual([]);
    expect(repository.getPreferenceSetDetail(id)?.preferences).toHaveLength(1);
    const facts = prepare(repository);
    expect(facts.supportingReactions).toEqual([]);
    expect(repository.commitPreferenceLearning({
      facts, scopes: [{ ...scope(facts), preferences: [] }], committedAt: now,
    }).status).toBe('committed');
    expect(repository.findPreferenceById('preference:1')).toBeUndefined();
    expect(repository.getPreferenceSetDetail(id)).toMatchObject({ preferenceSet: { revision: 2 }, preferences: [] });
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('learned');
  });

  it('rejects changed feedback without publishing partial preferences or acknowledgement', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    const facts = prepare(repository);
    setReaction(database, 1, 'disliked');
    expect(repository.commitPreferenceLearning({ facts, scopes: [scope(facts)], committedAt: now })).toEqual({
      status: 'rejected', reason: 'revision_conflict',
    });
    expect(repository.findPreferenceById('preference:1')).toBeUndefined();
    expect(repository.findPreferenceSetById(facts.currentPreferences[0].preferenceSet.id)?.revision).toBe(0);
    expect(repository.getPreferenceLearningCompletion('recommendation:1')).toMatchObject({
      status: 'pending', currentReactionRevision: 2, learnedReactionRevision: 0,
    });
  });

  it('rejects stale set versions, unprovided support, and missing scopes', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); seedRecommendation(database, 2);
    setReaction(database, 1, 'liked');
    const facts = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts, scopes: [scope(facts, ['recommendation:2'])], committedAt: now })).toEqual({
      status: 'rejected', reason: 'invalid_recommendation_reference',
    });
    expect(repository.commitPreferenceLearning({ facts, scopes: [], committedAt: now })).toEqual({ status: 'rejected', reason: 'scope_mismatch' });
    database.prepare({ sql: 'UPDATE discovery_preference_sets SET revision = 1 WHERE id = ?' }).run([facts.currentPreferences[0].preferenceSet.id]);
    expect(repository.commitPreferenceLearning({ facts, scopes: [scope(facts)], committedAt: now })).toEqual({ status: 'rejected', reason: 'revision_conflict' });
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.learnedReactionRevision).toBe(0);
  });

  it('rechecks historical supporting feedback before a later commit', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); seedRecommendation(database, 2);
    setReaction(database, 1, 'liked'); learn(repository);
    setReaction(database, 2, 'liked');
    const facts = prepare(repository);
    expect(facts.supportingReactions.map(({ recommendationId }) => recommendationId)).toContain('recommendation:1');
    setReaction(database, 1, null);
    expect(repository.commitPreferenceLearning({ facts, scopes: [scope(facts, ['recommendation:1', 'recommendation:2'])], committedAt: now })).toEqual({
      status: 'rejected', reason: 'invalid_recommendation_reference',
    });
    expect(repository.getPreferenceLearningCompletion('recommendation:2')?.learnedReactionRevision).toBe(0);
  });

  it('derives deadline, threshold, correction and restart recovery from feedback versions', () => {
    const { database, repository } = setup();
    expect(repository.getPreferenceLearningTrigger({ now })).toEqual({ status: 'idle' });
    for (let i = 1; i <= 3; i++) seedRecommendation(database, i);
    setReaction(database, 1, 'liked');
    expect(repository.getPreferenceLearningTrigger({ now })).toMatchObject({ status: 'scheduled', dueAt: '2026-08-27T08:10:00.000Z' });
    expect(repository.getPreferenceLearningTrigger({ now: '2026-08-27T08:10:00.000Z' })).toMatchObject({ status: 'ready', reason: 'deadline' });
    prepare(repository); // An interrupted process has not acknowledged anything.
    expect(prepare(repository).reactionChanges).toHaveLength(1);
    setReaction(database, 2, 'liked'); setReaction(database, 3, 'liked');
    expect(repository.getPreferenceLearningTrigger({ now })).toMatchObject({ status: 'ready', reason: 'threshold' });
    learn(repository);
    setReaction(database, 1, null);
    expect(repository.getPreferenceLearningTrigger({ now })).toMatchObject({ status: 'ready', reason: 'correction' });
  });

  it('rejects a preference ID owned by another set', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked'); learn(repository);
    repository.applyInterestChange({ action: 'create', interestId: 'interest:other', description: 'Other topic', now });
    seedRecommendation(database, 2);
    database.prepare({ sql: "UPDATE discovery_recommendations SET selection_basis_json = ? WHERE id = 'recommendation:2'" }).run([JSON.stringify({
      primaryInterestId: 'interest:other', matchedInterestIds: ['interest:other'],
      interestRevisions: [{ interestId: 'interest:other', revision: 1 }], preferenceRevisions: [],
    })]);
    setReaction(database, 2, 'liked');
    const facts = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts, scopes: [scope(facts, ['recommendation:2'])], committedAt: now })).toEqual({
      status: 'rejected', reason: 'invalid_preference_reference',
    });
    expect(repository.getPreferenceLearningCompletion('recommendation:2')?.learnedReactionRevision).toBe(0);
  });

  it('can acknowledge feedback whose matched interest was deleted without creating a preference set', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    repository.applyInterestChange({ action: 'delete', interestId: 'interest:agents', now });
    const facts = prepare(repository);
    expect(facts.currentPreferences).toEqual([]);
    expect(repository.commitPreferenceLearning({ facts, scopes: [], committedAt: now }).status).toBe('committed');
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('learned');
    expect(repository.listPreferenceSetDetails()).toEqual([]);
  });

  it('rolls back every mutation when a persistence write fails', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1); setReaction(database, 1, 'liked');
    const facts = prepare(repository);
    database.prepare({ sql: "CREATE TRIGGER fail_evidence BEFORE INSERT ON discovery_preference_evidence BEGIN SELECT RAISE(ABORT, 'test failure'); END" }).run();
    expect(() => repository.commitPreferenceLearning({ facts, scopes: [scope(facts)], committedAt: now })).toThrow();
    expect(repository.findPreferenceById('preference:1')).toBeUndefined();
    expect(repository.findPreferenceSetById(facts.currentPreferences[0].preferenceSet.id)?.revision).toBe(0);
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.learnedReactionRevision).toBe(0);
  });
});
