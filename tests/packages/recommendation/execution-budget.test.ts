/*
 * Verifies execution reservations and model usage against the production budget.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { createDiscoveryBudget } from '@megumi/application/recommendation/discovery/discovery-budget';
import { RecommendationLimitsSchema } from '@megumi/application/settings/definitions/recommendation';
import { recommendationFixture } from './recommendation-fixture';
it('reserves each logical search separately from its physical requests', () => {
  const budget = createDiscoveryBudget(
    RecommendationLimitsSchema.parse({
      maxSearchCalls: 2,
      maxSourceRequests: 3,
    }),
    0,
    () => 0,
  );

  expect(budget.reserve('searchCalls')).toBe(true);
  expect(budget.reserve('sourceRequests', 3)).toBe(true);
  expect(budget.reserve('sourceRequests')).toBe(false);
  expect(budget.reserve('searchCalls')).toBe(true);
  expect(budget.reserve('searchCalls')).toBe(false);
});
it('refunds unexecuted work and rejects requests after the round deadline', () => {
  let now = 0;
  const budget = createDiscoveryBudget(
    RecommendationLimitsSchema.parse({
      maxPlanningCalls: 1,
      maxDurationMinutes: 1,
    }),
    now,
    () => now,
  );

  expect(budget.reserve('planningCalls')).toBe(true);

  budget.release('planningCalls');

  expect(budget.reserve('planningCalls')).toBe(true);

  now = 60000;

  expect(budget.expired()).toBe(true);
  expect(budget.reserve('searchCalls')).toBe(false);
});
it('settles actual tokens and refuses a request that would exceed the total', () => {
  const f = recommendationFixture();
  const budget = createDiscoveryBudget(
    RecommendationLimitsSchema.parse({
      maxRequestInputTokens: 100,
      maxModelInputTokens: 100,
      maxModelOutputTokens: 4000,
    }),
    f.now(),
    f.now,
  );
  const reservation = budget.reserveModel('analysisCalls', f.model, 'Analyze', 'text');
  if (typeof reservation === 'string') throw new Error('Expected reservation.');

  budget.settleModel(reservation, {
    input: 90,
    output: 100,
  });

  expect(budget.snapshot().used).toMatchObject({
    modelInputTokens: 90,
    modelOutputTokens: 100,
  });
  expect(budget.reserveModel('analysisCalls', f.model, 'Analyze', 'a'.repeat(100))).toBe(
    'budget_exhausted',
  );
});
