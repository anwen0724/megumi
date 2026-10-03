/* Verifies preference learning owns its in-flight AI call through cancellation. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { fauxAssistantMessage } from '@megumi/ai';
import { createPreferenceLearning } from '@megumi/application/recommendation/preferences/preference-learning';
import { recommendationFixture, now } from './recommendation-fixture';
import { seedRecommendation } from '../discovery/preference-learning-fixtures';
import { deferred } from '../agent/agent-fixture';

it('commits preference evidence from a direct AI response without creating a conversation', async () => {
  const app = recommendationFixture();
  seedRecommendation(app.database, 1);
  app.repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
  const learning = createPreferenceLearning({ ...app, instructionDocuments: [],
    resolveModel: app.preparation.resolveModel, now: () => now,
    ids: { createBatchId: () => 'batch:1', createModelCallId: () => 'call:1' } });
  app.provider.setResponses([context => {
    const message = context.messages[0];
    if (message?.role !== 'user' || typeof message.content !== 'string') throw new Error('Feedback prompt missing.');
    const material = JSON.parse(message.content);
    const scope = material.currentPreferences[0];
    expect(material.reactionChanges[0].recommendationId).toBe('recommendation:1');
    return fauxAssistantMessage(JSON.stringify({ scopes: [{
      preferenceSetId: scope.preferenceSetId, baseRevision: scope.revision,
      reviewedPreferenceIds: [], outcome: 'changed', changes: [{ kind: 'add',
        statement: 'Prefer concrete implementation examples.', polarity: 'positive', dimension: 'content_type',
        evidence: [{ recommendationId: 'recommendation:1', relation: 'support', explanation: 'The liked article explains an implementation.' }],
      }],
    }] }));
  }]);
  try {
    const result = await learning.preparePreferencesForRecommendation({ requestId: 'learning:1' });
    expect(result.status).toBe('updated');
    const preferences = app.repository.listPreferenceSetDetails({ effectiveOnly: true }).flatMap(scope => scope.preferences);
    expect(preferences).toContainEqual(expect.objectContaining({ preference: expect.objectContaining({
      statement: 'Prefer concrete implementation examples.', origin: 'learned',
    }) }));
    expect(app.repository.getPreferenceLearningCompletion('recommendation:1')).toMatchObject({ status: 'learned' });
  } finally { await learning.shutdown(); app.cleanup(); }
});

it('waits for cancelled AI work to stop and leaves the feedback pending', async () => {
  const app = recommendationFixture();
  seedRecommendation(app.database, 1);
  app.repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
  const learning = createPreferenceLearning({ ...app, instructionDocuments: [],
    resolveModel: app.preparation.resolveModel, now: () => now,
    ids: { createBatchId: () => 'batch:1', createModelCallId: () => 'call:1' } });
  const entered = deferred();
  const release = deferred();
  let signal: AbortSignal | undefined;
  app.provider.setResponses([async (_context, options) => {
    signal = options?.signal;
    entered.resolve();
    await release.promise;
    return fauxAssistantMessage('{"scopes":[]}');
  }]);
  let closed = false;
  const operation = learning.preparePreferencesForRecommendation({ requestId: 'learning:1' });
  let shutdown: Promise<void> | undefined;
  try {
    await entered.promise;
    shutdown = learning.shutdown().then(() => { closed = true; });
    expect(signal?.aborted).toBe(true);
    // Drain cancellation continuations while the external provider remains blocked.
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    release.resolve();
    expect(await operation).toMatchObject({ status: 'cancelled' });
    await shutdown;
    expect(app.repository.getPreferenceLearningCompletion('recommendation:1')).toMatchObject({ status: 'pending' });
  } finally { release.resolve(); await operation; await learning.shutdown(); app.cleanup(); }
});
