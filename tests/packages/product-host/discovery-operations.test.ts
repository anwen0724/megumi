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
  it('requests, waits for, and rereads one durable Candidate Supply Check', async () => {
    application = composeTestApplication();
    await application.runtime.start();
    const receipt = await application.runtime.host.discovery.requestCandidateSupply({ trigger: 'evaluation' });
    expect(receipt).not.toBeNull();
    if (!receipt) return;

    const settled = await application.runtime.host.discovery.waitCandidateSupplyCheck({
      candidateSupplyId: receipt.candidateSupplyId,
      timeoutMs: 2_000,
    });
    expect(settled.status).toBe('completed');
    if (settled.status !== 'completed') return;
    const reread = await application.runtime.host.discovery.getCandidateSupplyCheck({
      candidateSupplyId: receipt.candidateSupplyId,
    });
    expect(reread).toEqual(settled.value);
  });

  it('reads exact Interest business facts by IDs', async () => {
    application = composeTestApplication();
    await application.runtime.start();
    const interest = await application.runtime.host.discovery.changeInterest({
      action: 'create', description: 'TypeScript architecture',
    });
    await expect(application.runtime.host.discovery.getInterestFacts({
      interestIds: [interest.interestId, 'interest:missing'],
      evidenceIds: [],
    })).resolves.toEqual({ interests: [interest], evidence: [] });
  });
});
