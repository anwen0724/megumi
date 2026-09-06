/*
 * Protects incremental learning, deletion evidence boundaries and stale-write rejection.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import type { DiscoveryRepository, LearnedScopeInput } from '@megumi/discovery';
import { createLearningFixture, seedRecommendation, now } from './preference-learning-fixtures';

function prepare(repository: DiscoveryRepository) {
  const facts = repository.preparePreferenceLearning({ batchId: 'b', startedAt: now, limit: 30 });
  if (!facts) throw new Error('Expected pending inputs');
  return facts;
}
function addition(facts: ReturnType<typeof prepare>, statement = '实测对比'): LearnedScopeInput {
  const set = facts.currentPreferences[0].preferenceSet;
  return { preferenceSetId: set.id, baseRevision: set.revision, outcome: 'changed', reviewedPreferenceIds: facts.reviewedPreferenceIds,
    changes: [{ kind: 'add', statement, polarity: 'positive', dimension: 'content_type', evidence: [{ recommendationId: 'recommendation:1', relation: 'support', explanation: 'Liked a worked comparison.' }] }] };
}

it('preserves omitted preferences and rejects learning results based on user-corrected input', () => {
  const { database, repository } = createLearningFixture();
  try {
    seedRecommendation(database, 1);
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
    const facts = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts, scopes: [addition(facts)], committedAt: now }).status).toBe('committed');
    const original = repository.listPreferenceSetDetails()[0].preferences[0].preference;
    seedRecommendation(database, 2);
    repository.updateState({ recommendationId: 'recommendation:2', action: 'set_reaction', reaction: 'liked' });
    const next = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts: next, scopes: [{ ...addition(next), changes: [], outcome: 'unchanged' }], committedAt: now }).status).toBe('committed');
    expect(repository.findPreferenceById(original.id)).toEqual(original);
    repository.editPreference({ preferenceId: original.id, expectedRevision: original.revision, statement: '用户要求', now });
    expect(repository.commitPreferenceLearning({ facts: next, scopes: [addition(next)], committedAt: now })).toMatchObject({ status: 'rejected', reason: 'revision_conflict' });
    expect(repository.findPreferenceById(original.id)?.statement).toBe('用户要求');
  } finally { database.close(); }
});

it('rejects recreation from old feedback and permits new supporting feedback after deletion', () => {
  const { database, repository } = createLearningFixture();
  try {
    seedRecommendation(database, 1);
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
    const initial = prepare(repository);
    repository.commitPreferenceLearning({ facts: initial, scopes: [addition(initial)], committedAt: now });
    const preference = repository.listPreferenceSetDetails()[0].preferences[0].preference;
    repository.deletePreference({ preferenceId: preference.id, expectedRevision: preference.revision, now });
    const old = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts: old, scopes: [addition(old)], committedAt: now })).toMatchObject({ status: 'rejected' });
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: null });
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
    const fresh = prepare(repository);
    expect(repository.commitPreferenceLearning({ facts: fresh, scopes: [addition(fresh)], committedAt: now }).status).toBe('committed');
    expect(repository.findPreferenceById(preference.id)?.status).toBe('deleted');
    expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences[0].preference.id).not.toBe(preference.id);
  } finally { database.close(); }
});
