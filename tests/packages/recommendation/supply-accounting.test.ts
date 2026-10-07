/*
 * Verifies actual yield settlement, planning failure and interest-local inventory.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
import { createDiscoveryStorage } from '@megumi/application/recommendation/discovery/discovery-storage';
it('settles a rejected search only once and does not count cache reuse as another zero yield', async () => {
  const f = recommendationFixture({
    respond: async (prompt) => prompt.stage === 'matching'
      ? { items: prompt.items!.map(item => ({ id: item.id, result: { status: 'rejected', relation: 'none', basis: '无关', evidence: [] } })) }
      : f.defaultRespond(prompt)
  });
  const interest = await f.owner.interests.createInterest({ text: '面试' });
  if (interest.status !== 'created')
    throw new Error('Expected interest.');
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  const discovery = createDiscoveryStorage(f.database, f.newId);
  expect(discovery.state().backoff[interest.interest.id]?.failures).toBe(1);
  f.advance(60 * 60000);
  await f.owner.supply.startMaintenance({ reason: 'periodic' }).result;
  expect(discovery.state().backoff[interest.interest.id]?.failures).toBe(1);
  expect(f.requests.filter(path => path === '/search')).toHaveLength(1);
});
it('reports an invalid plan without substituting user text into an unplanned search', async () => {
  const f = recommendationFixture({ respond: async () => ({ items: [] }) });
  await f.owner.interests.createInterest({ text: '面试' });
  const result = await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'MODEL_OUTPUT_INVALID' }));
  expect(f.requests).toEqual([]);
  expect(f.prompts).toHaveLength(2);
});
it('counts a duplicate group for each interest that has an actual qualified member', async () => {
  const f = recommendationFixture({ config: { enabledSources: [] } });
  const ids = [];
  for (const text of ['面试', '学习']) {
    const result = await f.owner.interests.createInterest({ text });
    if (result.status !== 'created')
      throw new Error('Expected interest.');
    ids.push(result.interest.id);
  }
  for (let index = 0; index < 2; index++) {
    const material = f.materials.saveMaterial({ platform: 'web', canonicalUrl: `https://example.com/copy-${index}`, text: '学习面试的准备方法', kind: 'full_text', truncated: false, rangeEnd: [...'学习面试的准备方法'].length, method: 'test', acquiredAt: f.now(), publicationEvidence: [] }).material;
    const evidence = [{ materialId: material.id, quote: '准备方法' }];
    f.materials.saveAnalysis({ contentId: material.contentId, materialId: material.id, now: f.now(), result: { summary: '学习面试', keyPoints: [{ text: '准备', evidence }], topics: ['面试'], contentType: 'article', qualityScore: 0.8, spamScore: 0, timeScope: { kind: 'unknown', evidence: [] } } });
    f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId: ids[index]!, interestRevision: 1, relation: 'direct', status: 'eligible', basis: '准备', evidence, reviewedAt: f.now(), validUntil: f.now() + 60000 });
  }
  expect(ids.map(id => f.candidates.inventory(f.now(), id, []))).toEqual([1, 1]);
  expect(f.candidates.listCandidates(f.now())).toHaveLength(1);
});
