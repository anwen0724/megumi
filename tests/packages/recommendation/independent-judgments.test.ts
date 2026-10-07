/*
 * Checks item-level validation, bounded correction and actual request reservations.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { z } from 'zod';
import { recommendationFixture } from './recommendation-fixture';
import { judgeItems } from '@megumi/application/recommendation/discovery/judge-items';
import { createDiscoveryBudget } from '@megumi/application/recommendation/discovery/discovery-budget';
import { createSourceQueue } from '@megumi/application/recommendation/discovery/source-queue';
import { RecommendationLimitsSchema } from '@megumi/application/settings/definitions/recommendation';
it('judges all complete items across a window larger than two request inputs', async () => {
  const f = recommendationFixture({ respond: async prompt => ({ items: prompt.items!.map(item => ({ id: item.id, result: { score: 0.8 } })) }) });
  const budget = createDiscoveryBudget(RecommendationLimitsSchema.parse({ maxRequestInputTokens: 1200 }), f.now(), f.now);
  const result = await judgeItems({ stage: 'analysis', instructions: 'Score each item.',
    items: Array.from({ length: 8 }, (_, index) => ({ id: `item-${index}`, data: { text: '材料'.repeat(1600) } })),
    validate: (_id, value) => z.object({ score: z.number() }).parse(value), client: f.client, model: f.model,
    budget, queue: createSourceQueue(() => 2), signal: new AbortController().signal });
  expect(result).toHaveLength(8);
  expect(result.every(item => item.status === 'ready')).toBe(true);
});
it('saves independent successes and corrects only duplicated or missing identifiers', async () => {
  let call = 0;
  const saved: string[] = [];
  const issues: string[] = [];
  const f = recommendationFixture({ respond: async (prompt) => ++call === 1 ? { items: [{ id: 'good', result: { score: 0.8 } }, { id: 'duplicate', result: { score: 0.4 } }, { id: 'duplicate', result: { score: 0.6 } }, { id: 'unknown', result: { score: 0.5 } }] } : { items: prompt.items!.map(item => ({ id: item.id, result: { score: 0.7 } })) } });
  const budget = createDiscoveryBudget(RecommendationLimitsSchema.parse({}), f.now(), f.now);
  const result = await judgeItems({ stage: 'analysis', instructions: 'Score each item.', items: ['good', 'duplicate', 'missing'].map(id => ({ id, data: {} })), validate: (_id, value) => z.object({ score: z.number().min(0).max(1) }).strict().parse(value), client: f.client, model: f.model, budget, queue: createSourceQueue(() => 2), signal: new AbortController().signal, onSuccess: id => { saved.push(id); }, onIssue: code => issues.push(code) });
  expect(result.map(item => item.status)).toEqual(['ready', 'ready', 'ready']);
  expect(saved).toEqual(['good', 'duplicate', 'missing']);
  expect(f.prompts[1]!.items!.map(item => item.id)).toEqual(['duplicate', 'missing']);
  expect(issues).toEqual(['UNKNOWN_RESULT_ID']);
  expect(budget.snapshot().used.analysisCalls).toBe(2);
});
it('does not claim an input when the model budget cannot reserve its request', async () => {
  const f = recommendationFixture();
  const budget = createDiscoveryBudget(RecommendationLimitsSchema.parse({ maxAnalysisCalls: 0 }), f.now(), f.now);
  let claims = 0;
  const outcomes = await judgeItems({ stage: 'analysis', instructions: 'Analyze.', items: [{ id: 'one', data: {} }], validate: (_id, value) => value, client: f.client, model: f.model, budget, queue: createSourceQueue(() => 1), signal: new AbortController().signal, beforeRequest: () => { claims++; return true; } });
  expect(claims).toBe(0);
  expect(f.prompts).toEqual([]);
  expect(outcomes).toMatchObject([{ status: 'failed', code: 'BUDGET_EXHAUSTED' }]);
});
it('releases a reservation when another owner already claimed the input', async () => {
  const f = recommendationFixture();
  const budget = createDiscoveryBudget(RecommendationLimitsSchema.parse({}), f.now(), f.now);
  await judgeItems({ stage: 'analysis', instructions: 'Analyze.', items: [{ id: 'one', data: {} }], validate: (_id, value) => value, client: f.client, model: f.model, budget, queue: createSourceQueue(() => 1), signal: new AbortController().signal, beforeRequest: () => false });
  expect(f.prompts).toEqual([]);
  expect(budget.snapshot().used.analysisCalls).toBe(0);
  expect(budget.snapshot().used.modelInputTokens).toBe(0);
});
