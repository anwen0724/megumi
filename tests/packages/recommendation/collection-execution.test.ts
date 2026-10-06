/* Verifies collection cancellation and committed candidate facts through its product entry. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { createCandidates } from '@megumi/application/recommendation/collection/collect-candidates';
import { deferred } from '../agent/agent-fixture';
import { recommendationFixture, now, poolSettings } from './recommendation-fixture';

it('retains submitted candidates when the following model request fails', async () => {
  const app = recommendationFixture();
  const collection = createCandidates({ ...app, now: () => now, ids: { createRequestId: () => 'collection:1' } });
  app.provider.setResponses([
    fauxAssistantMessage(fauxToolCall('search_content', { sourceId: 'open_web', query: 'Agent architecture',
      mode: 'relevance', limit: 1, targetInterestIds: ['interest:1'] }), { stopReason: 'toolUse' }),
    context => {
      expect(app.repository.getCandidatePoolSnapshot(poolSettings).availableCount).toBe(0);
      const message = context.messages.find(message => message.role === 'toolResult');
      const text = message?.content.find(block => block.type === 'text');
      if (text?.type !== 'text') throw new Error('Source results missing.');
      const result = JSON.parse(text.text);
      return fauxAssistantMessage(fauxToolCall('submit_candidates', { items: [{ resultId: result.results[0].resultId,
        contentSummary: 'Concrete Agent patterns.', matches: [{ interestId: 'interest:1', relevance: 'direct', matchReason: 'Covers Agent architecture.' }] }] }),
        { stopReason: 'toolUse' });
    },
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Invalid API key' }),
  ]);
  try {
    expect(await collection.ensureSupply('startup')).toMatchObject({ status: 'failed', addedCandidateCount: 1,
      availableCount: 1, failure: { code: 'MODEL_CALL_FAILED' } });
    expect(app.repository.getCandidatePoolSnapshot(poolSettings).availableCount).toBe(1);
    // Background execution must not create conversation records.
    expect(app.database.prepare<{ count: number }>({ sql: 'SELECT COUNT(*) AS count FROM sessions' }).get()?.count).toBe(0);
  } finally { await collection.shutdown(); app.cleanup(); }
});

it('cancels the active model request on shutdown and waits for it to stop', async () => {
  const app = recommendationFixture();
  const entered = deferred();
  const release = deferred();
  let modelSignal: AbortSignal | undefined;
  let stopped = false;
  const collection = createCandidates({ ...app, now: () => now, ids: { createRequestId: () => 'collection:1' } });
  app.provider.setResponses([async (_context, options) => {
    modelSignal = options?.signal;
    entered.resolve();
    await release.promise;
    return fauxAssistantMessage('Finished.');
  }]);
  const completion = collection.ensureSupply('startup');
  try {
    await entered.promise;
    const shutdown = collection.shutdown().then(() => { stopped = true; });
    expect(modelSignal?.aborted).toBe(true);
    expect(stopped).toBe(false);
    release.resolve();
    expect(await completion).toMatchObject({ status: 'cancelled' });
    await shutdown;
  } finally { release.resolve(); await completion; await collection.shutdown(); app.cleanup(); }
});
