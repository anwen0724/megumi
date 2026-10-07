/*
 * Verifies production composition exposes local interest and source operations.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('changes interests through the host without external work', async () => {
  const f = recommendationFixture();
  const created = await f.owner.host.changeInterest({ action: 'create', description: '面试' });
  expect(created).toMatchObject({ status: 'changed', interests: [{ text: '面试', enabled: true, revision: 1 }] });
  if (created.status !== 'changed')
    throw new Error('Expected interest.');
  const interest = created.interests[0]!;
  expect(await f.owner.host.changeInterest({ action: 'update', interestId: interest.id, expectedRevision: 1, description: '前端面试' })).toMatchObject({ status: 'changed', interests: [{ revision: 2, text: '前端面试' }] });
  expect(await f.owner.host.changeInterest({ action: 'delete', interestId: interest.id, expectedRevision: 1 })).toEqual({ status: 'revision_conflict' });
  expect(f.requests).toEqual([]);
  expect(f.prompts).toEqual([]);
});
it('keeps source state queryable while disabled and never enables work during a read', async () => {
  const f = recommendationFixture({ config: { enabled: false } });
  expect(await f.owner.host.getConfiguration()).toMatchObject({ candidateSupplyConfirmed: false, sources: expect.arrayContaining([expect.objectContaining({ sourceId: 'tavily', enabled: true })]) });
  expect(await f.owner.supply.startMaintenance({ reason: 'startup' }).result).toMatchObject({ status: 'disabled' });
  expect((await f.owner.supply.listCandidates()).candidates).toEqual([]);
  expect(f.requests).toEqual([]);
  expect(f.prompts).toEqual([]);
});
