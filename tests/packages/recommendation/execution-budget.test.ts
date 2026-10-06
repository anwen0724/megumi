/* Verifies one round's execution budget reserves, charges, and expires. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createExecutionBudget } from '@megumi/application/recommendation/supply/execution-budget';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';

const limits = CandidateSupplyConfigurationSchema.parse({}).limits;

describe('execution budget', () => {
  it('reserves one unit per reservation and refuses work beyond the limit', () => {
    const budget = createExecutionBudget({
      limits: { ...limits, maxSearchCalls: 2 },
      startedAt: 0,
      now: () => 0,
    });

    expect(budget.reserve('searchCalls')).toBe(true);
    expect(budget.remaining('searchCalls')).toBe(1);
    expect(budget.reserve('searchCalls')).toBe(true);
    expect(budget.reserve('searchCalls')).toBe(false);
    expect(budget.remaining('searchCalls')).toBe(0);
  });

  it('returns a reservation that never reached the external work', () => {
    const budget = createExecutionBudget({
      limits: { ...limits, maxPlanningCalls: 1 },
      startedAt: 0,
      now: () => 0,
    });

    expect(budget.reserve('planningCalls')).toBe(true);
    budget.release('planningCalls');

    expect(budget.reserve('planningCalls')).toBe(true);
  });

  it('stops accepting work once the round deadline passed', () => {
    let now = 1_000;
    const budget = createExecutionBudget({
      limits: { ...limits, maxDurationMinutes: 1 },
      startedAt: 1_000,
      now: () => now,
    });

    expect(budget.expired).toBe(false);

    now = 1_000 + 60_000;

    expect(budget.expired).toBe(true);
    expect(budget.reserve('searchCalls')).toBe(false);
  });

  it('charges the round model budget and keeps the remainder available', () => {
    const budget = createExecutionBudget({
      limits: { ...limits, maxModelInputTokens: 100, maxModelOutputTokens: 50 },
      startedAt: 0,
      now: () => 0,
    });

    expect(budget.reserveModelTokens({ inputTokens: 60, outputTokens: 20 })).toBe(true);
    expect(budget.reserveModelTokens({ inputTokens: 60, outputTokens: 20 })).toBe(false);
    expect(budget.remainingModelTokens()).toEqual({ inputTokens: 40, outputTokens: 30 });
  });
});
