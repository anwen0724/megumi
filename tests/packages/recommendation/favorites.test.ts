/*
 * Verifies favorites pin the displayed material and remain available after interest deletion.
 */
// @vitest-environment node
import { expect, it } from 'vitest';
import { recommendationFixture } from './recommendation-fixture';
it('retains unchanged content for thirty days after its most recent acquisition', async () => {
  const f = recommendationFixture({ config: { enabledSources: [] } });
  const first = f.saveAnalyzedMaterial('https://reacquired.example.com/article');
  f.advance(29 * 86400000);
  const { id, contentId, revision, ...input } = first;
  const repeated = f.materials.saveMaterial({ ...input, acquiredAt: f.now() });
  expect(repeated.material.id).toBe(id);
  f.advance(2 * 86400000);
  await f.owner.cleanup();
  expect(f.materials.readCurrentMaterial(contentId)?.id).toBe(id);
  f.advance(29 * 86400000);
  await f.owner.cleanup();
  expect(f.materials.readCurrentMaterial(contentId)).toBeUndefined();
});
it('keeps the originally saved material across repeated saves, content upgrades and restart', async () => {
  const f = recommendationFixture();
  const created = await f.owner.interests.createInterest({ text: '面试' });
  if (created.status !== 'created')
    throw new Error('Interest setup failed');
  await f.owner.supply.startMaintenance({ reason: 'startup' }).result;
  const candidate = (await f.owner.supply.listCandidates()).candidates[0]!;
  expect(await f.owner.host.setFavorite({ contentId: candidate.contentId, materialId: candidate.materialId, saved: true })).toMatchObject({ saved: true, changed: true });
  expect(await f.owner.host.setFavorite({ contentId: candidate.contentId, materialId: candidate.materialId, saved: true })).toMatchObject({ saved: true, changed: false });
  const { id, contentId, revision, ...material } = candidate.material;
  f.materials.saveMaterial({ ...material, text: '正文更新：另一种面试准备方法', rangeStart: 0, rangeEnd: 14, acquiredAt: f.now() + 1 });
  await f.owner.interests.deleteInterest({ interestId: created.interest.id, expectedRevision: created.interest.revision });
  await f.restart();
  const saved = await f.owner.host.listFavorites({});
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0]?.materialId).toBe(candidate.materialId);
  expect(saved.items[0]?.excerpt).toBe(candidate.material.text);
  expect(await f.owner.host.setFavorite({ contentId: candidate.contentId, saved: false })).toMatchObject({ saved: false, changed: true });
  expect((await f.owner.host.listFavorites({})).items).toEqual([]);
});
it('protects pinned historical materials during retention cleanup and releases unreferenced content after cancellation', async () => {
  const f = recommendationFixture();
  const pinned = f.saveAnalyzedMaterial('https://saved.example.com/article');
  const discard = f.saveAnalyzedMaterial('https://discard.example.com/article');
  await f.owner.host.setFavorite({ contentId: pinned.contentId, materialId: pinned.id, saved: true });
  const { id, contentId, revision, ...material } = pinned;
  const text = '新的正文包含更完整的准备方法。';
  f.materials.saveMaterial({ ...material, text, rangeEnd: [...text].length, acquiredAt: f.now() + 1 });
  f.advance(31 * 86400000);
  await f.owner.cleanup();
  expect(f.materials.readMaterial(pinned.id)).toBeDefined();
  expect(f.materials.readCurrentMaterial(discard.contentId)).toBeUndefined();
  expect((await f.owner.host.listFavorites({})).items[0]?.materialId).toBe(pinned.id);
  await f.owner.host.setFavorite({ contentId: pinned.contentId, saved: false });
  await f.owner.cleanup();
  expect(f.materials.readMaterial(pinned.id)).toBeUndefined();
});
it('abandons old pending analysis without letting its own reference keep content forever', async () => {
  const f = recommendationFixture();
  const materials = [];
  for (const name of ['orphan', 'saved']) {
    const text = '尚未分析的材料';
    const material = f.materials.saveMaterial({ platform: 'web', canonicalUrl: `https://${name}.example.com/pending`, text, kind: 'full_text', truncated: false, rangeEnd: [...text].length, method: 'direct_web', acquiredAt: f.now(), publicationEvidence: [] }).material;
    f.database.prepare({ sql: "INSERT INTO content_analysis(content_id,material_id,contract_version,status) VALUES(?,?,2,'pending')" }).run([material.contentId, material.id]);
    materials.push(material);
  }
  const orphan = materials[0]!;
  const saved = materials[1]!;
  await f.owner.host.setFavorite({ contentId: saved.contentId, materialId: saved.id, saved: true });
  f.advance(31 * 86400000);
  await f.owner.cleanup();
  expect(f.materials.readMaterial(orphan.id)).toBeUndefined();
  expect((await f.owner.host.listFavorites({})).items[0]?.materialId).toBe(saved.id);
});
