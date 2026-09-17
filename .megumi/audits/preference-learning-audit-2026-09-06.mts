/*
 * Reproduces preference-learning information boundaries against isolated in-memory
 * business repositories. Simulated model decisions are probes, not quality scores.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { LearnedScopeInput, PreferenceLearningFacts } from '@megumi/discovery';
import { createLearningFixture, now, seedRecommendation, setReaction } from '../../tests/packages/discovery/preference-learning-fixtures.ts';

const results: Record<string, unknown> = {};

/** Seeds two independent feedback opportunities with identifiable original evidence. */
function setup() {
  const fixture = createLearningFixture();
  for (const index of [1, 2]) {
    seedRecommendation(fixture.database, index);
    fixture.database.prepare({ sql: 'UPDATE discovery_recommendation_contents SET content_excerpt = ? WHERE recommendation_id = ?' })
      .run([`original-content-marker-${index}: includes practical steps and comparison experiments.`, `recommendation:${index}`]);
  }
  return fixture;
}

/** Captures the actual public learning snapshot; assertions check fixture readiness. */
function snapshot(repository: ReturnType<typeof createLearningFixture>['repository'], batchId: string): PreferenceLearningFacts {
  const facts = repository.preparePreferenceLearning({ batchId, startedAt: now, limit: 20 });
  assert.ok(facts);
  return facts;
}

/** Creates the complete replacement scope expected by the current repository contract. */
function nextScope(facts: PreferenceLearningFacts, preferences: LearnedScopeInput['preferences']): LearnedScopeInput {
  const set = facts.currentPreferences[0]?.preferenceSet;
  assert.ok(set);
  return { preferenceSetId: set.id, baseRevision: set.revision, preferences };
}

{
  const { database, repository } = setup();
  try {
    setReaction(database, 1, 'liked');
    const first = snapshot(repository, 'audit:sparse:1');
    assert.equal(repository.commitPreferenceLearning({ facts: first, scopes: [nextScope(first, [])], committedAt: now }).status, 'committed');
    setReaction(database, 2, 'liked', '2026-08-27T09:00:00.000Z');
    const second = snapshot(repository, 'audit:sparse:2');
    results.sparseFeedbackAfterAbstention = {
      simulatedModelDecision: 'No preference was justified by the first feedback; return an empty next set.',
      firstFeedbackCompletion: repository.getPreferenceLearningCompletion('recommendation:1')?.status,
      nextBatchFeedbackIds: second.reactionChanges.map((change) => change.recommendationId),
      nextBatchSupportingIds: second.supportingReactions.map((support) => support.recommendationId),
      nextBatchContainsFirstContent: JSON.stringify(second).includes('original-content-marker-1'),
      firstFeedbackStillStored: Boolean(repository.getPreferenceLearningCompletion('recommendation:1')),
    };
  } finally { database.close(); }
}

{
  const { database, repository } = setup();
  try {
    setReaction(database, 1, 'liked');
    const first = snapshot(repository, 'audit:history:1');
    const preferenceId = randomUUID();
    assert.equal(repository.commitPreferenceLearning({ facts: first, committedAt: now, scopes: [nextScope(first, [{
      id: preferenceId, polarity: 'positive', dimension: 'expression_quality',
      statement: '偏好包含实践步骤与对照实验的教程。', supportingRecommendationIds: ['recommendation:1'],
    }])] }).status, 'committed');
    setReaction(database, 2, 'liked', '2026-08-27T09:00:00.000Z');
    const second = snapshot(repository, 'audit:history:2');
    results.historicalEvidenceVisibility = {
      initialBatchContainsOriginalContent: JSON.stringify(first).includes('original-content-marker-1'),
      nextBatchContainsOriginalContent: JSON.stringify(second).includes('original-content-marker-1'),
      historicalSupportFields: Object.keys(second.supportingReactions.find((item) => item.recommendationId === 'recommendation:1') ?? {}),
      retainedStatements: second.currentPreferences.flatMap((group) => group.preferences.map((entry) => entry.preference.statement)),
    };
    const outcome = repository.commitPreferenceLearning({ facts: second, scopes: [nextScope(second, [])], committedAt: now });
    results.omittedExistingPreference = {
      simulatedModelDecision: 'The complete replacement list accidentally omits a still-supported existing preference.',
      commitStatus: outcome.status,
      existingPreferenceSurvives: Boolean(repository.findPreferenceById(preferenceId)),
      originalFeedbackCompletion: repository.getPreferenceLearningCompletion('recommendation:1')?.status,
    };
  } finally { database.close(); }
}

{
  const { database, repository } = setup();
  try {
    setReaction(database, 1, 'liked');
    const facts = snapshot(repository, 'audit:semantic:1');
    const preferenceId = randomUUID();
    const outcome = repository.commitPreferenceLearning({ facts, committedAt: now, scopes: [nextScope(facts, [{
      id: preferenceId, polarity: 'negative', dimension: 'source',
      statement: '用户不喜欢整个开放网页平台的所有内容。', supportingRecommendationIds: ['recommendation:1'],
    }])] });
    results.semanticValidationBoundary = {
      simulatedModelDecision: 'An unsupported platform-wide dislike inferred from a liked article, with valid IDs and versions.',
      commitStatus: outcome.status,
      resultingStatement: repository.findPreferenceById(preferenceId)?.statement,
    };
  } finally { database.close(); }
}

const report = { kind: 'repository-audit-probes', timestamp: new Date().toISOString(), results };
await writeFile(new URL('./preference-learning-audit-2026-09-06.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
