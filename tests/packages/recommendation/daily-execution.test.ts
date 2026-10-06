/* Verifies daily publication and shutdown through the product, real Agent and real storage. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { createRecommendations } from '@megumi/application/recommendation/daily/generate-recommendations';
import { recommendationFixture, now } from './recommendation-fixture';
import { deferred } from '../agent/agent-fixture';

it('accepts a corrected draft and publishes its ordered selection once', async () => {
  const app = recommendationFixture();
  const ids = app.seedCandidates(2);
  const product = createRecommendations({ ...app, clock: { now: () => now }, timezone: { get: () => 'UTC' } });
  app.provider.setResponses([
    fauxAssistantMessage(fauxToolCall('submit_recommendations', {
      items: [{ candidateId: ids[0], recommendationReason: 'Relevant.' }],
    }), { stopReason: 'toolUse' }),
    context => {
      expect(app.repository.getCollection('2026-10-03', true)).toBeUndefined();
      expect(context.messages.some(message => message.role === 'toolResult' && message.isError)).toBe(true);
      return fauxAssistantMessage(fauxToolCall('submit_recommendations', {
        items: [ids[1], ids[0]].map(candidateId => ({ candidateId, recommendationReason: 'Relevant architecture.' })),
      }), { stopReason: 'toolUse' });
    },
  ]);
  try {
    const accepted = await product.generate({ trigger: 'manual' });
    if (accepted.status !== 'started') throw new Error('Recommendation was not admitted.');
    expect(await product.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({
      status: 'published', collection: { items: [{ candidateId: ids[1] }, { candidateId: ids[0] }] },
    });
    expect(await product.generate({ trigger: 'manual' })).toMatchObject({ status: 'already_published' });
  } finally { await product.shutdown(); app.cleanup(); }
});

it('waits for an aborted model call to finish before settling the product request', async () => {
  const app = recommendationFixture();
  app.seedCandidates(2);
  const entered = deferred();
  const release = deferred();
  let signal: AbortSignal | undefined;
  const product = createRecommendations({ ...app, clock: { now: () => now }, timezone: { get: () => 'UTC' } });
  app.provider.setResponses([async (_context, options) => {
    signal = options?.signal;
    entered.resolve();
    await release.promise;
    return fauxAssistantMessage('Finished.');
  }]);
  let shutdown: Promise<void> | undefined;
  try {
    const accepted = await product.generate({ trigger: 'manual' });
    if (accepted.status !== 'started') throw new Error('Recommendation was not admitted.');
    await entered.promise;
    shutdown = product.shutdown();
    expect(signal?.aborted).toBe(true);
    expect(product.getToday()).toMatchObject({ status: 'running' });
    release.resolve();
    expect(await product.wait({ requestId: accepted.requestId, timeoutMs: 2000 })).toMatchObject({ status: 'cancelled' });
    await shutdown;
    expect(app.repository.getCollection('2026-10-03', true)).toBeUndefined();
  } finally { release.resolve(); await shutdown; await product.shutdown(); app.cleanup(); }
});
