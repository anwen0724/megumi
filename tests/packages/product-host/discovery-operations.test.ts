/* Verifies Product Host exposes durable Discovery business facts without owning their state. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  composeTestApplication,
  type TestApplication,
} from '../composition/compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Discovery Product Host operations', () => {
  it('returns the final Candidate Supply result and exposes the derived Candidate Pool', async () => {
    application = composeTestApplication();
    await application.runtime.start();
    const result = await application.runtime.host.discovery.requestCandidateSupply({
      trigger: 'supply_conditions_changed',
    });
    expect(result).toMatchObject({
      status: 'not_needed',
      reason: 'no_active_interest',
      trigger: 'supply_conditions_changed',
      addedCandidateCount: 0,
    });
    await expect(application.runtime.host.discovery.getCandidatePool()).resolves.toMatchObject({
      minimumCount: 100,
      targetCount: 160,
      maximumCount: 200,
      availableCount: 0,
    });
  });

  it('reads exact Interest business facts by IDs', async () => {
    application = composeTestApplication();
    await application.runtime.start();
    const interest = await application.runtime.host.discovery.changeInterest({
      action: 'create', description: 'TypeScript architecture',
    });
    await expect(application.runtime.host.discovery.getInterestFacts({
      interestIds: [interest.id, 'interest:missing'],
      evidenceIds: [],
    })).resolves.toEqual({ interests: [interest], evidence: [] });
  });
});
