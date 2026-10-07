/*
 * Exercises input changes, long material, missing dependencies and disabled background work.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('analyzes every segment of a long material before qualifying it', async () => {
  const f = recommendationFixture({
    config: { enabledSources: [] }, respond: async (prompt) => {
      if (prompt.stage === 'analysis')
        f.advance(20000); return f.defaultRespond(prompt);
    }
  });
  await f.owner.interests.createInterest({ text: '面试准备' });
  const text = '面试准备方法\n'.repeat(6000);
  const material = f.materials.saveMaterial({ platform: 'web', canonicalUrl: 'https://example.com/long', text, kind: 'full_text', rangeEnd: [...text].length, truncated: false, method: 'test', acquiredAt: f.now(), publicationEvidence: [] }).material;
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  const segments = f.prompts.filter(p => p.stage === 'analysis').map(p => p.items![0]!.text);
  expect(segments.length).toBeGreaterThan(1);
  expect(segments.join('')).toBe(text);
  expect(f.materials.readAnalysis(material.contentId, material.id)).toBeDefined();
  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(1);
  expect(f.requests).toEqual([]);
});
it('saving an interest never starts external work, even with recommendation enabled', async () => {
  const f = recommendationFixture();
  await f.owner.interests.createInterest({ text: '面试准备' });
  expect(f.requests).toEqual([]);
  expect(f.prompts).toEqual([]);
});
it('stops active supply when the global configuration is disabled', async () => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<unknown>();
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'analysis') {
        entered.resolve();
        return gate.promise;
      } return f.defaultRespond(prompt);
    }
  });
  await f.owner.interests.createInterest({ text: '面试准备' });
  const round = f.owner.supply.startMaintenance({ reason: 'startup' });
  await entered.promise;
  const settings = f.settings.readSettings();
  if (settings.status !== 'ok')
    throw new Error('Expected settings.');
  expect(f.settings.updateSettings({ expectedRevision: settings.settings.revision, patch: { discovery: { enabled: false } } }).status).toBe('updated');
  gate.resolve(f.defaultRespond(f.prompts.find(p => p.stage === 'analysis')!));
  expect((await round.result).status).toBe('cancelled');
  expect((await f.owner.supply.listCandidates()).candidates).toEqual([]);
});
it('does not restore current qualification after disabling and re-enabling an interest', async () => {
  const f = recommendationFixture();
  const created = await f.owner.interests.createInterest({ text: '面试准备' });
  if (created.status !== 'created')
    throw new Error('Expected interest.');
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(1);
  await f.owner.interests.updateInterest({ interestId: created.interest.id, expectedRevision: 1, enabled: false });
  expect((await f.owner.supply.listCandidates()).candidates).toEqual([]);
  await f.owner.interests.updateInterest({ interestId: created.interest.id, expectedRevision: 2, enabled: true });
  expect((await f.owner.supply.listCandidates()).candidates).toEqual([]);
  await f.owner.supply.startMaintenance({ reason: 'periodic' }).result;
  expect((await f.owner.supply.listCandidates()).candidates).toHaveLength(1);
  expect(f.prompts.filter(p => p.stage === 'analysis')).toHaveLength(1);
});
