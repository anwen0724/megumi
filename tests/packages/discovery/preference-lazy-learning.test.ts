/*
 * Verifies on-demand learning and retained history through the real learning boundary.
 */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPreferenceLearning } from '@megumi/application/recommendation/preferences/preference-learning';
import { type PreferenceLearningFacts } from '@megumi/application/recommendation/preferences/preference-rules';
import { completedMessage, model } from '../context/context-test-fixtures';
import { createLearningFixture, seedRecommendation, now } from './preference-learning-fixtures';

it('learns only on demand and reuses inconclusive historical feedback on the next demand', async () => {
  const { database, repository } = createLearningFixture();
  seedRecommendation(database, 1);
  repository.updateState({
    recommendationId: 'recommendation:1',
    action: 'set_reaction',
    reaction: 'liked',
  });
  let facts: { currentPreferences: Array<{ preferenceSetId: string; revision: number }>; reviewedPreferenceIds: string[];
    reactionChanges: Array<{ recommendationId: string }> } | undefined;
  const models = {
    completeSimple: vi.fn(async (_model, context) => {
      facts = JSON.parse(context.messages[0].content);
      if (!facts) throw new Error('Missing learning context');
      return completedMessage(
        JSON.stringify({
          scopes: facts.currentPreferences.map(preferenceSet => ({
            preferenceSetId: preferenceSet.preferenceSetId,
            baseRevision: preferenceSet.revision,
            changes: [],
            reviewedPreferenceIds: [],
            outcome: 'insufficient',
          })),
        }),
      );
    }),
  };
  const runtime = createPreferenceLearning({
    repository,
    ai: models, instructionDocuments: [], resolveModel: async () => model,
    now: () => now,
    ids: { createBatchId: () => 'batch', createModelCallId: () => 'call' },
  });
  try {
    await runtime.start();
    runtime.notifyReactionChanged();
    expect(models.completeSimple).not.toHaveBeenCalled();
    await runtime.preparePreferencesForRecommendation({ requestId: 'request' });
    expect(models.completeSimple).toHaveBeenCalledTimes(1);
    await runtime.preparePreferencesForRecommendation({ requestId: 'request2' });
    expect(models.completeSimple).toHaveBeenCalledTimes(1);
    seedRecommendation(database, 2);
    repository.updateState({
      recommendationId: 'recommendation:2',
      action: 'set_reaction',
      reaction: 'liked',
    });
    await runtime.preparePreferencesForRecommendation({ requestId: 'request3' });
    expect(facts?.reactionChanges.map((entry) => entry.recommendationId).sort()).toEqual([
      'recommendation:1',
      'recommendation:2',
    ]);
    expect(repository.getPreferenceLearningCompletion('recommendation:2')?.status).toBe('learned');
  } finally {
    await runtime.shutdown();
    database.close();
  }
});
