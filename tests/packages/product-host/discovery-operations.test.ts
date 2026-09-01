/* Verifies Product Host exposes durable Discovery receipts without owning their state. */
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

  it('returns a bounded timeout instead of inferring completion from Trace or Log', async () => {
    application = composeTestApplication();
    await application.runtime.start();
    await expect(application.runtime.host.discovery.waitInterestUnderstanding({
      interestUnderstandingId: 'interest-understanding:missing',
      timeoutMs: 1,
    })).resolves.toEqual({ status: 'timed_out' });
  });
});
