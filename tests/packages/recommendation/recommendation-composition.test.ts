/*
 * Verifies production composition exposes local interest and source operations.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('changes interests through the host without external work', async () => {
  const f = recommendationFixture();
  const created = await f.owner.host.createInterest({ text: '面试' });

  expect(created).toMatchObject({
    status: 'created',
    interest: {
      text: '面试',
      enabled: true,
      revision: 1,
    },
  });

  if (created.status !== 'created') throw new Error('Expected interest.');

  const interest = created.interest;

  expect(
    await f.owner.host.updateInterest({
      interestId: interest.id,
      expectedRevision: 1,
      text: '前端面试',
    }),
  ).toMatchObject({
    status: 'updated',
    interest: {
      revision: 2,
      text: '前端面试',
    },
  });
  await expect(
    f.owner.host.deleteInterest({
      interestId: interest.id,
      expectedRevision: 1,
    }),
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  expect(f.requests).toEqual([]);
  expect(f.prompts).toEqual([]);
});

it('reads and cancels candidate supply runs through the public run operations', async () => {
  const f = recommendationFixture();
  await f.owner.host.createInterest({ text: '面试' });

  const started = f.owner.supply.startMaintenance({ reason: 'startup' });
  await started.result;

  expect(await f.owner.host.getRun({ runId: started.id })).toMatchObject({
    id: started.id,
    kind: 'candidate_supply',
    status: 'completed',
  });
  expect(await f.owner.host.cancelRun({ runId: started.id })).toEqual({
    status: 'already_finished',
  });
  expect(await f.owner.host.cancelRun({ runId: 'missing-run' })).toEqual({ status: 'not_found' });
});

it('rejects inconsistent display limits and request budgets before configuration changes take effect', async () => {
  const f = recommendationFixture();
  const initial = await f.owner.host.getConfiguration();
  for (const changes of [
    { curated: { targetCount: 31 } },
    { dailyFeed: { maxItemsPerInterest: 31 } },
    { dailyFeed: { historyDays: 8 } },
    { limits: { maxRequestInputTokens: 200001 } },
  ]) {
    await expect(
      f.owner.host.updateConfiguration({
        expectedRevision: initial.revision,
        changes,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  }

  expect((await f.owner.host.getConfiguration()).revision).toBe(initial.revision);
});
it('keeps source state queryable while disabled and never enables work during a read', async () => {
  const f = recommendationFixture({ config: { enabled: false } });

  expect(await f.owner.host.getConfiguration()).toMatchObject({
    config: { enabled: false },
    sources: expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'tavily',
        enabled: true,
      }),
    ]),
  });
  expect(await f.owner.supply.startMaintenance({ reason: 'startup' }).result).toMatchObject({
    status: 'disabled',
  });
  expect((await f.owner.supply.listCandidates()).candidates).toEqual([]);
  expect(f.requests).toEqual([]);
  expect(f.prompts).toEqual([]);
});
