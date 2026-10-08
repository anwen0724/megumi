/*
 * Protects supply recovery, query reuse, backlog and cancellation through the production owner.
 */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { recommendationFixture, type ModelPrompt } from './recommendation-fixture';
import { RecommendationLimitsSchema } from '@megumi/application/settings/definitions/recommendation';
it('keeps healthy discovery moving when a restored analysis occupies the model slot', async () => {
  const gate = Promise.withResolvers<unknown>();
  const entered = Promise.withResolvers<void>();
  const f = recommendationFixture({
    config: { limits: RecommendationLimitsSchema.parse({ maxConcurrentModelRequests: 1 }) },

    respond: async prompt => {
      if (prompt.stage === 'analysis') {
        entered.resolve();
        return gate.promise;
      }

      return f.defaultRespond(prompt);
    },
  });
  await f.owner.interests.createInterest({ text: '面试准备' });
  f.materials.saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/previous',
    text: '面试准备方法',
    kind: 'full_text',
    truncated: false,
    rangeEnd: 6,
    method: 'test',
    acquiredAt: f.now(),
    publicationEvidence: [],
  });

  const round = f.owner.supply.startMaintenance({ reason: 'startup' });
  await entered.promise;

  try {
    await vi.waitFor(() => expect(f.requests).toEqual(['/search']), { timeout: 500 });
  } finally {
    const cancelled = f.owner.supply.cancel();
    gate.resolve({ items: [] });
    await cancelled;
    await round.result;
  }
});
it('reuses a successful query without searching again while retrying incomplete analysis', async () => {
  let fail = true;
  const f = recommendationFixture({
    respond: async prompt =>
      fail && prompt.stage === 'analysis' ? { items: [] } : f.defaultRespond(prompt),
  });
  await f.owner.interests.createInterest({ text: '面试准备' });
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;

  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(0);

  const first = f.database
    .prepare<{
      status: string;
    }>({ sql: 'SELECT status FROM discovery_runs' })
    .get();

  expect(first?.status).toBe('partial');

  f.advance(60000);
  fail = false;
  await f.owner.supply.startMaintenance({ reason: 'periodic' }).result;

  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(1);
  expect(f.requests).toEqual(['/search']);
  expect(
    f.database
      .prepare<{
        yield_summary: string;
      }>({ sql: 'SELECT yield_summary FROM discovery_runs ORDER BY started_at LIMIT 1' })
      .get()?.yield_summary,
  ).toContain('completed');
});
it('joins repeated starts and cancels without saving a late model response', async () => {
  let release: (value: unknown) => void = () => undefined;
  const entered = Promise.withResolvers<void>();
  const f = recommendationFixture({
    respond: async prompt => {
      if (prompt.stage === 'analysis') {
        entered.resolve();
        return new Promise(resolve => {
          release = resolve;
        });
      }

      return f.defaultRespond(prompt);
    },
  });
  await f.owner.interests.createInterest({ text: '面试准备' });

  const first = f.owner.supply.startMaintenance({ reason: 'startup' });
  const second = f.owner.supply.startMaintenance({ reason: 'periodic' });

  expect(first.id).toBe(second.id);

  await entered.promise;

  const cancel = f.owner.supply.cancel();
  release(f.defaultRespond(f.prompts.find(p => p.stage === 'analysis')!));
  await cancel;

  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(0);
  expect(
    f.database.prepare({ sql: "SELECT 1 FROM content_analysis WHERE status='ready'" }).all(),
  ).toEqual([]);
  expect(
    f.database
      .prepare({ sql: 'SELECT 1 FROM content_analysis WHERE owner_run_id IS NOT NULL' })
      .all(),
  ).toEqual([]);
});
it('does not start new searches when this interest already has 60 actionable materials', async () => {
  const gate = Promise.withResolvers<unknown>();
  const entered = Promise.withResolvers<void>();
  const f = recommendationFixture({
    respond: async (prompt: ModelPrompt) => {
      if (prompt.stage === 'analysis' || prompt.stage === 'matching') {
        entered.resolve();
        return gate.promise;
      }

      return f.defaultRespond(prompt);
    },
  });
  await f.owner.interests.createInterest({ text: '面试准备' });
  for (let i = 0; i < 60; i++) {
    const material = f.materials.saveMaterial({
      platform: 'web',
      canonicalUrl: `https://example.com/${i}`,
      text: `面试准备方法 ${i}`,
      kind: 'full_text',
      truncated: false,
      rangeEnd: [...`面试准备方法 ${i}`].length,
      method: 'test',
      acquiredAt: f.now(),
      publicationEvidence: [],
    }).material;
    const evidence = [
      {
        materialId: material.id,
        quote: '准备方法',
      },
    ];
    f.materials.saveAnalysis({
      contentId: material.contentId,
      materialId: material.id,
      result: {
        summary: '准备方法',
        keyPoints: [
          {
            text: '面试方法',
            evidence,
          },
        ],
        topics: ['面试'],
        contentType: 'article',
        qualityScore: 0.8,
        spamScore: 0,
        timeScope: {
          kind: 'unknown',
          evidence: [],
        },
      },
      now: f.now(),
    });
  }

  const round = f.owner.supply.startMaintenance({ reason: 'startup' });
  await entered.promise;

  try {
    await new Promise(resolve => setImmediate(resolve));

    expect(f.prompts.some(p => p.stage === 'planning')).toBe(false);
    expect(f.requests).toHaveLength(0);
  } finally {
    const cancelled = f.owner.supply.cancel();
    gate.resolve({ items: [] });
    await cancelled;
    await round.result;
  }
});
