/*
 * Verifies selection from saved candidates and preservation of committed results.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
import { RecommendationConfigurationSchema } from '@megumi/application/settings/definitions/recommendation';
import type { ModelPrompt } from './recommendation-fixture';
it('starts the waiting initial selection after daily supply creates its first candidate', async () => {
  let interestId = '';
  let searches = 0;
  const f = recommendationFixture({ fetch: async () => Response.json({ results: ++searches === 1 ? [] : [{ url: 'https://example.com/from-daily', title: '面试准备', content: '完整正文包含面试的准备方法。', raw_content: '完整正文包含面试的准备方法。' }] }), respond: async prompt => {
    if (prompt.stage === 'value' || prompt.stage === 'selection') return readingResponse(prompt, interestId);
    return f.defaultRespond(prompt);
  } });
  f.advance(-2 * 3600000);
  interestId = (await f.owner.interests.createInterest({ text: '面试' })).interest.id;
  await f.owner.startBackground();
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  await f.owner.curated.check();
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
  await f.owner.host.startDailyFeed({ requestId: 'daily-supply-first-candidate' });
  await f.owner.daily.completion();
  await f.owner.curated.completion();
  await expect.poll(async () => (await f.owner.host.getCuratedSelection()).selection?.items.length).toBe(1);
});
it('supersedes an active selection as soon as its last interest is removed', async () => {
  const entered = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<unknown>();
  let interestId = '';
  const f = recommendationFixture({ respond: async prompt => {
    if (prompt.stage === 'value') { entered.resolve(); return gate.promise; }
    return readingResponse(prompt, interestId);
  } });
  const interest = await seedQualified(f, 1); interestId = interest.id;
  const started = await f.owner.host.startCuratedSelection({ requestId: 'remove-last-interest' });
  if (started.status === 'no_candidates') throw new Error('Missing candidates');
  await entered.promise;
  await f.owner.host.deleteInterest({ interestId, expectedRevision: interest.revision });
  await f.owner.curated.check();
  const status = (await f.owner.host.getRun({ runId: started.runId }))?.status;
  gate.resolve(readingResponse(f.prompts.find(prompt => prompt.stage === 'value')!, interestId));
  await f.owner.curated.completion();
  expect(status).toBe('superseded');
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
});
function readingResponse(prompt: ModelPrompt, interestId: string, limit?: number) {
  const items = prompt.items!.slice(0, limit);
  return { items: items.map(item => prompt.stage === 'value' ? { id: item.id, result: { worthReading: true, reason: '解释面试准备的方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }], matchedInterestIds: [interestId] } } : { contentId: item.id, reason: '解释面试准备的方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }], matchedInterestIds: [interestId] }) };
}
it('rolls back a failed publication and never notifies a result that was not committed', async () => {
  let interestId = '';
  const f = recommendationFixture({ respond: async (prompt) => readingResponse(prompt, interestId) });
  interestId = (await seedQualified(f, 1)).id;
  await f.owner.host.startCuratedSelection({ requestId: 'atomic-original' });
  await f.owner.curated.completion();
  const original = (await f.owner.host.getCuratedSelection()).selection!;
  const material = f.saveAnalyzedMaterial('https://new.example.com/atomic');
  f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId, interestRevision: 1, relation: 'direct', status: 'eligible', basis: '对应准备方法', evidence: [{ materialId: material.id, quote: '准备方法' }], reviewedAt: f.now(), validUntil: f.now() + 86400000 });
  f.database.prepare({ sql: "CREATE TEMP TRIGGER fail_selection_item BEFORE INSERT ON curated_selection_items BEGIN SELECT RAISE(ABORT,'Injected write failure'); END" }).run();
  const events: string[] = [];
  f.owner.onChanged(event => events.push(event.kind));
  const started = await f.owner.host.startCuratedSelection({ requestId: 'atomic-failure' });
  if (started.status === 'no_candidates')
    throw new Error('Missing alternatives');
  await f.owner.curated.completion();
  expect((await f.owner.host.getCuratedSelection()).selection).toEqual(original);
  expect((await f.owner.host.getRun({ runId: started.runId }))?.status).toBe('failed');
  expect(events).not.toContain('curated_selection');
  await f.restart();
  expect((await f.owner.host.getCuratedSelection()).selection).toEqual(original);
});
async function seedQualified(f: ReturnType<typeof recommendationFixture>, count: number, domain = 'example.com') {
  const result = await f.owner.interests.createInterest({ text: '面试' });
  if (result.status !== 'created')
    throw new Error('Interest setup failed');
  for (let index = 0; index < count; index++) {
    const material = f.saveAnalyzedMaterial(`https://${domain}/${index}`, `作者${index}`);
    f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId: result.interest.id, interestRevision: result.interest.revision, relation: 'direct', status: 'eligible', basis: '面试准备', evidence: [{ materialId: material.id, quote: '准备方法' }], reviewedAt: f.now(), validUntil: f.now() + 86400000 });
  }
  return result.interest;
}
it('selects only saved candidates and preserves that selection when a swap has no alternatives', async () => {
  let interestId = '';
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'value')
        return { items: prompt.items!.map(item => ({ id: item.id, result: { worthReading: true, reason: '解释面试准备的方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }], matchedInterestIds: [interestId] } })) };
      if (prompt.stage === 'selection')
        return { items: prompt.items!.map(item => ({ contentId: item.id, reason: '解释面试准备的方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }], matchedInterestIds: [interestId] })) };
      return f.defaultRespond(prompt);
    }
  });
  const created = await f.owner.interests.createInterest({ text: '面试' });
  if (created.status !== 'created')
    throw new Error('Interest setup failed');
  interestId = created.interest.id;
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  const calls = f.requests.length;
  const started = await f.owner.host.startCuratedSelection({ requestId: 'first-curated' });
  expect(started.status).toBe('started');
  await f.owner.curated.completion();
  const first = await f.owner.host.getCuratedSelection();
  expect(first.selection?.items).toHaveLength(1);
  expect(f.requests).toHaveLength(calls);
  expect(await f.owner.host.startCuratedSelection({ requestId: 'swap-empty' })).toMatchObject({ status: 'no_candidates' });
  expect((await f.owner.host.getCuratedSelection()).selection?.id).toBe(first.selection?.id);
  await f.restart();
  expect((await f.owner.host.getCuratedSelection()).selection?.items).toHaveLength(1);
});
it('rejects overrepresented publishers and accepts a bounded correction without consuming qualification', async () => {
  let interestId = '';
  let comparisons = 0;
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'value')
        return readingResponse(prompt, interestId);
      if (prompt.stage === 'selection')
        return readingResponse(prompt, interestId, ++comparisons === 1 ? 4 : 3);
      return f.defaultRespond(prompt);
    }
  });
  interestId = (await seedQualified(f, 4)).id;
  await f.owner.host.startCuratedSelection({ requestId: 'publisher-cap' });
  await f.owner.curated.completion();
  expect((await f.owner.host.getCuratedSelection()).selection?.items).toHaveLength(3);
  expect(comparisons).toBe(2);
  expect(f.candidates.listEligible(f.now())).toHaveLength(4);
});
it('does not publish a comparison for an interest set that changed while the model ran', async () => {
  let interestId = '';
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'selection') {
        const interest = (await f.owner.interests.listInterests()).interests[0]!;
        await f.owner.interests.updateInterest({ interestId: interest.id, expectedRevision: interest.revision, text: '新的职业方向' });
      }
      if (prompt.stage === 'value' || prompt.stage === 'selection')
        return readingResponse(prompt, interestId);
      return f.defaultRespond(prompt);
    }
  });
  interestId = (await seedQualified(f, 1)).id;
  const events: string[] = [];
  f.owner.onChanged(event => events.push(event.kind));
  const started = await f.owner.host.startCuratedSelection({ requestId: 'obsolete-interest' });
  if (started.status === 'no_candidates')
    throw new Error('Missing candidates');
  await f.owner.curated.completion();
  expect((await f.owner.host.getRun({ runId: started.runId }))?.status).toBe('superseded');
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
  expect(events).not.toContain('curated_selection');
});
it('rechecks expiry inside publication and keeps the actual result empty when all inputs expire', async () => {
  let interestId = '';
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'selection')
        f.advance(2 * 86400000);
      if (prompt.stage === 'value' || prompt.stage === 'selection')
        return readingResponse(prompt, interestId);
      return f.defaultRespond(prompt);
    }
  });
  interestId = (await seedQualified(f, 1)).id;
  const started = await f.owner.host.startCuratedSelection({ requestId: 'expired-input' });
  if (started.status === 'no_candidates')
    throw new Error('Missing candidates');
  await f.owner.curated.completion();
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
  expect((await f.owner.host.getRun({ runId: started.runId }))?.issues).toContainEqual(expect.objectContaining({ code: 'INPUT_CHANGED' }));
});
it('persists initial waiting and automatically selects once, leaving later supply outside the saved result', async () => {
  let interestId = '';
  let comparisons = 0;
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'value')
        return readingResponse(prompt, interestId);
      if (prompt.stage === 'selection') {
        comparisons++;
        return readingResponse(prompt, interestId);
      }
      return f.defaultRespond(prompt);
    }
  });
  const created = await f.owner.interests.createInterest({ text: '面试' });
  if (created.status !== 'created')
    throw new Error('Interest setup failed');
  interestId = created.interest.id;
  await f.owner.curated.check();
  await f.restart();
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  await f.owner.curated.check();
  await f.owner.curated.completion();
  const first = (await f.owner.host.getCuratedSelection()).selection;
  expect(first?.items).toHaveLength(1);
  const material = f.saveAnalyzedMaterial('https://another.example.com/extra');
  f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId, interestRevision: 1, relation: 'direct', status: 'eligible', basis: '面试方法', evidence: [{ materialId: material.id, quote: '准备方法' }], reviewedAt: f.now(), validUntil: f.now() + 86400000 });
  await f.owner.curated.check();
  await f.owner.curated.completion();
  expect((await f.owner.host.getCuratedSelection()).selection?.id).toBe(first?.id);
  expect(comparisons).toBe(1);
});
it('persists an independent swap shortage even when normal inventory is sufficient, without resuming the swap', async () => {
  let interestId = '';
  let comparisons = 0;
  const f = recommendationFixture({
    config: RecommendationConfigurationSchema.parse({ enabled: true, candidateSupply: { interestMinimumCount: 0, interestTargetCount: 2 } }), respond: async (prompt) => {
      if (prompt.stage === 'value')
        return readingResponse(prompt, interestId);
      if (prompt.stage === 'selection') {
        comparisons++;
        return readingResponse(prompt, interestId);
      }
      return f.defaultRespond(prompt);
    }
  });
  interestId = (await seedQualified(f, 1)).id;
  await f.owner.host.startCuratedSelection({ requestId: 'swap-baseline' });
  await f.owner.curated.completion();
  const original = (await f.owner.host.getCuratedSelection()).selection!.id;
  const calls = f.requests.length;
  expect(await f.owner.host.startCuratedSelection({ requestId: 'swap-no-alternatives' })).toEqual({ status: 'no_candidates' });
  expect(f.requests).toHaveLength(calls);
  await f.restart();
  await f.owner.supply.startMaintenance({ reason: 'periodic' }).result;
  expect(f.requests.length).toBeGreaterThan(calls);
  expect(f.candidates.inventory(f.now(), interestId, [])).toBeGreaterThan(1);
  expect((await f.owner.host.getCuratedSelection()).selection?.id).toBe(original);
  expect(comparisons).toBe(1);
});
it('requires interest coverage before assigning extra comparison slots', async () => {
  let primary = '';
  let comparison = 0;
  const f = recommendationFixture({
    config: RecommendationConfigurationSchema.parse({ enabled: true, curated: { targetCount: 2 } }), respond: async (prompt) => {
      const items = prompt.stage === 'selection' && ++comparison === 1 ? prompt.items!.filter(item => item.qualifications?.some(pair => pair.interestId === primary)).slice(0, 2) : prompt.items!.slice(0, prompt.stage === 'selection' ? 2 : undefined);
      return { items: items.map(item => { const result = { reason: '具体准备方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }], matchedInterestIds: item.qualifications!.map(pair => pair.interestId) }; return prompt.stage === 'value' ? { id: item.id, result: { ...result, worthReading: true } } : { ...result, contentId: item.id }; }) };
    }
  });
  primary = (await seedQualified(f, 2)).id;
  const other = await f.owner.interests.createInterest({ text: '职业选择' });
  if (other.status !== 'created')
    throw new Error('Interest setup failed');
  const material = f.saveAnalyzedMaterial('https://other.example.com/choice');
  f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId: other.interest.id, interestRevision: 1, relation: 'direct', status: 'eligible', basis: '职业准备', evidence: [{ materialId: material.id, quote: '准备方法' }], reviewedAt: f.now(), validUntil: f.now() + 86400000 });
  await f.owner.host.startCuratedSelection({ requestId: 'final-coverage' });
  await f.owner.curated.completion();
  const labels = (await f.owner.host.getCuratedSelection()).selection?.items.flatMap(item => item.interestLabels.map(label => label.interestId));
  expect(labels).toContain(other.interest.id);
  expect(comparison).toBe(2);
});
it('admits complete shortlist entries within the final request budget rather than failing the entire comparison', async () => {
  let interestId = '';
  let finalCount = 0;
  const f = recommendationFixture({
    config: RecommendationConfigurationSchema.parse({ enabled: true, limits: { maxRequestInputTokens: 1400 } }), respond: async (prompt) => {
      if (prompt.stage === 'selection') {
        finalCount = prompt.items!.length;
        return readingResponse(prompt, interestId, 3);
      }
      return readingResponse(prompt, interestId);
    }
  });
  interestId = (await seedQualified(f, 7)).id;
  await f.owner.host.startCuratedSelection({ requestId: 'bounded-shortlist' });
  await f.owner.curated.completion();
  expect((await f.owner.host.getCuratedSelection()).selection?.items.length).toBeGreaterThan(0);
  expect(finalCount).toBeLessThan(7);
  expect(finalCount).toBeGreaterThan(0);
  expect(f.candidates.listEligible(f.now())).toHaveLength(7);
});
it('replays a joined request after completion instead of executing a second swap when its response was lost', async () => {
  let interestId = '';
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'value')
        await gate;
      return readingResponse(prompt, interestId);
    }
  });
  interestId = (await seedQualified(f, 2)).id;
  const first = await f.owner.host.startCuratedSelection({ requestId: 'original-request' });
  if (first.status === 'no_candidates')
    throw new Error('Missing candidates');
  expect(await f.owner.host.startCuratedSelection({ requestId: 'joined-request' })).toEqual({ status: 'joined', runId: first.runId });
  release();
  await f.owner.curated.completion();
  expect(await f.owner.host.startCuratedSelection({ requestId: 'joined-request' })).toEqual({ status: 'joined', runId: first.runId });
  await f.restart();
  expect(await f.owner.host.startCuratedSelection({ requestId: 'joined-request' })).toEqual({ status: 'joined', runId: first.runId });
  expect(f.prompts.filter(prompt => prompt.stage === 'selection')).toHaveLength(1);
});
it('covers sparse interests before truncating the input and rotates previously unentered candidates', async () => {
  const valueInputs: string[][] = [];
  const f = recommendationFixture({
    config: RecommendationConfigurationSchema.parse({ enabled: true, curated: { maxCandidateCount: 2, shortlistCount: 2, targetCount: 2 } }), respond: async (prompt) => {
      if (prompt.stage === 'value') {
        valueInputs.push(prompt.items!.map(item => item.id));
        return { items: prompt.items!.map(item => ({ id: item.id, result: { worthReading: false, reason: '已有摘要未提供具体新增价值', evidence: [], matchedInterestIds: [] } })) };
      }
      return f.defaultRespond(prompt);
    }
  });
  const interests = [];
  for (const text of ['面试', '求职']) {
    const result = await f.owner.interests.createInterest({ text });
    if (result.status !== 'created')
      throw new Error('Interest setup failed');
    interests.push(result.interest);
  }
  const materials = Array.from({ length: 7 }, (_, index) => f.saveAnalyzedMaterial(`https://author${index}.example.com/interview`, `author${index}`)).sort((a, b) => a.contentId.localeCompare(b.contentId));
  for (const [index, material] of materials.entries()) {
    const interest = interests[index === materials.length - 1 ? 1 : 0]!;
    f.candidates.saveQualification({ contentId: material.contentId, materialId: material.id, interestId: interest.id, interestRevision: interest.revision, relation: 'direct', status: 'eligible', basis: '对应求职方法', evidence: [{ materialId: material.id, quote: '准备方法' }], reviewedAt: f.now(), validUntil: f.now() + 86400000 });
  }
  const sparse = materials.at(-1)!;
  await f.owner.host.startCuratedSelection({ requestId: 'coverage-one' });
  await f.owner.curated.completion();
  expect(valueInputs[0]).toHaveLength(2);
  expect(valueInputs[0]).toContain(sparse.contentId);
  await f.owner.host.startCuratedSelection({ requestId: 'coverage-two' });
  await f.owner.curated.completion();
  expect(valueInputs[1]).toHaveLength(1);
  expect(valueInputs[1]![0]).not.toBe(valueInputs[0]!.find(id => id !== sparse.contentId));
  expect(f.candidates.listEligible(f.now())).toHaveLength(7);
});
it('does not consume extra automatic attempts when lifecycle checks arrive together', async () => {
  let interestId = '';
  const f = recommendationFixture({ respond: async () => ({ items: [] }) });
  interestId = (await seedQualified(f, 1)).id;
  const runIds = new Set<string>();
  f.owner.onChanged(event => {
    if (event.kind === 'run' && event.runId)
      runIds.add(event.runId);
  });
  await Promise.all([f.owner.curated.check(), f.owner.curated.check()]);
  await f.owner.curated.completion();
  for (let index = 0; index < 2; index++) {
    f.advance(300001);
    await f.owner.curated.check();
    await f.owner.curated.completion();
  }
  expect(runIds.size).toBe(3);
  expect((await f.owner.interests.listInterests()).interests[0]?.id).toBe(interestId);
});
it('keeps the comparison frozen when current qualification changes, then drops the input at publication', async () => {
  let interestId = '';
  let comparisons = 0;
  const f = recommendationFixture({
    respond: async (prompt) => {
      if (prompt.stage === 'value') {
        const { id, contentId, revision, ...old } = f.materials.readMaterial(prompt.items![0]!.materialId)!;
        f.materials.saveMaterial({ ...old, text: old.text + '新增内容', rangeEnd: [...old.text + '新增内容'].length, acquiredAt: f.now() });
      }
      if (prompt.stage === 'selection')
        comparisons++;
      return readingResponse(prompt, interestId);
    }
  });
  interestId = (await seedQualified(f, 1)).id;
  const started = await f.owner.host.startCuratedSelection({ requestId: 'changed-material-frozen' });
  if (started.status === 'no_candidates')
    throw new Error('Missing candidates');
  await f.owner.curated.completion();
  expect(comparisons).toBe(1);
  expect((await f.owner.host.getRun({ runId: started.runId }))?.status).toBe('completed');
  expect((await f.owner.host.getCuratedSelection()).selection).toBeUndefined();
});
it('does not discard a swap supplement while an unrelated interest gets its daily feed', async () => {
  let interestId = '';
  const f = recommendationFixture({
    config: RecommendationConfigurationSchema.parse({ enabled: true, candidateSupply: { interestMinimumCount: 0, interestTargetCount: 2 } }), respond: async (prompt) => {
      if (prompt.stage === 'value' || prompt.stage === 'selection')
        return readingResponse(prompt, interestId);
      return f.defaultRespond(prompt);
    }
  });
  interestId = (await seedQualified(f, 1)).id;
  await f.owner.host.startCuratedSelection({ requestId: 'supplement-first' });
  await f.owner.curated.completion();
  expect(await f.owner.host.startCuratedSelection({ requestId: 'supplement-empty' })).toEqual({ status: 'no_candidates' });
  const other = await f.owner.host.createInterest({ text: '领域新闻' });
  await f.owner.host.startDailyFeed({ requestId: 'other-daily', interestIds: [other.interest.id] });
  await f.owner.daily.completion();
  const searches = f.prompts.filter(prompt => prompt.stage === 'planning').length;
  await f.restart();
  await f.owner.supply.startMaintenance({ reason: 'periodic' }).result;
  expect(f.prompts.filter(prompt => prompt.stage === 'planning').length).toBeGreaterThan(searches);
});
