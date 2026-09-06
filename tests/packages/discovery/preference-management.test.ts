/*
 * Exercises user corrections through Discovery's public persistence operations.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { createLearningFixture, seedRecommendation, now } from './preference-learning-fixtures';

it('protects an edited requirement after its original feedback is withdrawn', () => {
  const { database, repository } = createLearningFixture();
  try {
    seedRecommendation(database, 1);
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
    const set = repository.listPreferenceSetDetails()[0].preferenceSet;
    database.prepare({ sql: "INSERT INTO discovery_preferences (id,preference_set_id,origin,polarity,dimension,statement,status,created_at,updated_at) VALUES ('p',?,'learned','positive','topic','实测评测','active',?,?)" }).run([set.id, now, now]);
    database.prepare({ sql: "INSERT INTO discovery_preference_evidence (id,preference_id,recommendation_id,reaction_revision,reaction,relation,created_at,updated_at) VALUES ('e','p','recommendation:1',1,'liked','support',?,?)" }).run([now, now]);
    expect(repository.editPreference({ preferenceId: 'p', expectedRevision: 1, statement: '减少纯带货内容', now })).toMatchObject({ status: 'updated', preference: { id: 'p', origin: 'user', statement: '减少纯带货内容', revision: 2 } });
    repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: null });
    expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences).toMatchObject([{ preference: { id: 'p', origin: 'user', statement: '减少纯带货内容' } }]);
    expect(repository.editPreference({ preferenceId: 'p', expectedRevision: 1, statement: '旧编辑', now })).toMatchObject({ status: 'revision_conflict' });
    expect(repository.getPreferenceDetails({ scope: 'interest', interestId: 'interest:agents' })).toMatchObject({ hasPendingLearning: true, preferences: [{ validity: 'effective', preference: { origin: 'user' } }] });
    expect(repository.getPreferenceEvidence('p')).toMatchObject({ historicalSourceOnly: true, evidence: [{ current: false, title: 'Recommendation 1' }] });
  } finally { database.close(); }
});

it('keeps deletion boundaries stable and stops paused interests from supplying requirements', () => {
  const { database, repository } = createLearningFixture();
  try {
    const interest = repository.applyInterestChange({ action: 'create', interestId: 'i', description: '摄影', now });
    const set = repository.listPreferenceSetDetails()[0].preferenceSet;
    database.prepare({ sql: "INSERT INTO discovery_preferences (id,preference_set_id,origin,statement,status,user_edited_at,created_at,updated_at) VALUES ('p',?,'user','实测对比','active',?,?,?)" }).run([set.id, now, now, now]);
    repository.applyInterestChange({ action: 'pause', interestId: interest.id, now });
    expect(repository.listPreferenceSetDetails({ effectiveOnly: true })).toEqual([]);
    expect(repository.findInterestById('i')?.descriptionUserEditedAt).toBe(now);
    repository.applyInterestChange({ action: 'resume', interestId: interest.id, now });
    expect(repository.deletePreference({ preferenceId: 'p', expectedRevision: 1, now }).status).toBe('deleted');
    const deleted = repository.findPreferenceById('p');
    expect(repository.deletePreference({ preferenceId: 'p', expectedRevision: 1, now }).status).toBe('already_deleted');
    expect(repository.findPreferenceById('p')).toEqual(deleted);
    expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences).toEqual([]);
    expect(repository.findPreferenceSetById(set.id)?.policyRevision).toBeGreaterThanOrEqual(3);
  } finally { database.close(); }
});
