/*
 * Verifies acquired material upgrades through Content's persistence boundary.
 */
// @vitest-environment node
import fs from 'node:fs';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';
import { createCandidateQualificationStorage } from '@megumi/application/recommendation/candidates/candidate-qualification-storage';
import { rehearsalFolder } from './foundation-fixture';
import { afterEach, expect, it } from 'vitest';
let database: DatabaseConnection;
let folder: string;
afterEach(() => { database?.close(); if (folder) fs.rmSync(folder, { recursive: true, force: true }); });
it('keeps content identity and the old material when the same URL yields fuller text', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const content = createMaterialStorage(database);
  const excerpt = content.saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/article?utm_source=search',
    text: '摘要',
    kind: 'excerpt',
    truncated: false,
    rangeEnd: 2,
    method: 'bing_rss',
    acquiredAt: 10,
    publicationEvidence: []
  });
  const fullText = content.saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/article',
    text: '摘要和完整正文',
    kind: 'full_text',
    truncated: false,
    rangeEnd: 7,
    method: 'direct_web',
    acquiredAt: 20,
    publicationEvidence: []
  });
  expect(fullText.material.contentId).toBe(excerpt.material.contentId);
  expect(fullText.material.revision).toBe(2);
  expect(content.readMaterial(excerpt.material.id)?.text).toBe('摘要');
});
it('invalidates old qualification immediately and rejects its late commit after material changes', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  database.prepare({
    sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','面试',1,0,0)"
  }).run();
  const content = createMaterialStorage(database);
  const candidates = createCandidateQualificationStorage(database);
  const input = {
    platform: 'web',
    canonicalUrl: 'https://example.com/article',
    text: '面试材料',
    kind: 'full_text' as const,
    truncated: false,
    rangeEnd: 4,
    method: 'direct_web',
    acquiredAt: 10,
    publicationEvidence: []
  };
  const material = content.saveMaterial(input).material;
  const evidence = [{ materialId: material.id, quote: '面试材料' }];
  content.saveAnalysis({
    contentId: material.contentId,
    materialId: material.id,
    result: {
      summary: '面试材料',
      keyPoints: [{ text: '面试', evidence }],
      topics: ['面试'],
      contentType: 'article',
      qualityScore: 0.5,
      spamScore: 0,
      timeScope: { kind: 'unknown', evidence: [] }
    },
    now: 20
  });
  const qualification = {
    contentId: material.contentId,
    interestId: 'i1',
    interestRevision: 1,
    materialId: material.id,
    relation: 'direct' as const,
    status: 'eligible' as const,
    basis: '包含面试材料',
    evidence,
    reviewedAt: 20,
    validUntil: 100
  };
  expect(candidates.saveQualification(qualification).status).toBe('saved');
  expect(candidates.listEligible(30)).toHaveLength(1);
  content.saveMaterial({ ...input, title: '更新的标题', acquiredAt: 40 });
  expect(candidates.listEligible(40)).toEqual([]);
  expect(candidates.saveQualification({ ...qualification, reviewedAt: 40 }).status).toBe('input_changed');
  expect(content.readAnalysis(material.contentId, material.id)?.summary).toBe('面试材料');
});
it('records another acquisition without changing equal material or its revision', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const content = createMaterialStorage(database);
  const input = {
    platform: 'bilibili',
    externalId: 'BV1test',
    canonicalUrl: 'https://www.bilibili.com/video/BV1test',
    title: '面试技巧',
    text: '简介',
    kind: 'description' as const,
    truncated: false,
    rangeEnd: 2,
    method: 'bilibili_api',
    acquiredAt: 10,
    publicationEvidence: []
  };
  const first = content.saveMaterial(input);
  const repeated = content.saveMaterial({
    ...input,
    canonicalUrl: 'https://www.bilibili.com/video/BV1test/?share_source=copy',
    method: 'browser',
    acquiredAt: 20
  });
  expect(repeated.status).toBe('unchanged');
  expect(repeated.material.id).toBe(first.material.id);
  expect(repeated.material.revision).toBe(1);
  expect(database.prepare({ sql: 'SELECT method,acquired_at FROM material_acquisitions ORDER BY acquired_at' }).all()).toEqual([{ method: 'bilibili_api', acquired_at: 10 }, { method: 'browser', acquired_at: 20 }]);
});
it('retains identity when a platform identifier is learned after the first acquisition', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const content = createMaterialStorage(database);
  const input = { platform: 'bilibili', canonicalUrl: 'https://www.bilibili.com/video/BV1test', text: '简介', kind: 'description' as const, truncated: false, rangeEnd: 2, method: 'browser', acquiredAt: 10, publicationEvidence: [] };
  const first = content.saveMaterial(input).material;
  const identified = content.saveMaterial({ ...input, externalId: 'BV1test', acquiredAt: 20 }).material;
  const aliased = content.saveMaterial({ ...input, externalId: 'BV1test', canonicalUrl: 'https://www.bilibili.com/video/av123', acquiredAt: 30 }).material;
  expect(identified.contentId).toBe(first.contentId);
  expect(aliased.contentId).toBe(first.contentId);
  expect(aliased.id).toBe(first.id);
  expect(content.readCurrentMaterial(first.contentId)?.externalId).toBe('BV1test');
});
it('preserves verified dates on a later excerpt without downgrading the current full text', () => {
  database = createDatabase({ filename: ':memory:' });
  folder = rehearsalFolder();
  migrateDatabase({ database, migrationsFolder: folder });
  const content = createMaterialStorage(database);
  const input = { platform: 'web', canonicalUrl: 'https://example.com/date', text: '完整材料', kind: 'full_text' as const, truncated: false, rangeEnd: 4, method: 'tavily_extract', acquiredAt: 10, publicationEvidence: [] };
  const full = content.saveMaterial(input).material;
  const evidence = { kind: 'published' as const, value: '2026-10-06T12:00:00Z', precision: 'instant' as const, timezone: 'UTC', location: 'page.JSON-LD.datePublished', rawValue: '2026-10-06T12:00:00Z', status: 'verified' as const };
  const excerpt = content.saveMaterial({ ...input, kind: 'excerpt', text: '材料', rangeEnd: 2, method: 'direct_web', acquiredAt: 20, publicationEvidence: [evidence] }).material;
  expect(excerpt.publicationEvidence).toEqual([evidence]);
  expect(content.readMaterial(excerpt.id)?.text).toBe('材料');
  expect(content.readCurrentMaterial(full.contentId)?.id).toBe(full.id);
});
it('keeps the previous material pointer when saving an acquisition fails', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const ids = ['c1', 'm1', 'a1', 'm2', 'a1'];
  const content = createMaterialStorage(database, () => {
    const id = ids.shift(); if (!id) throw new Error('Missing test identifier'); return id;
  });
  const input = { platform: 'web', canonicalUrl: 'https://example.com/1', text: '材料', kind: 'excerpt' as const, truncated: false, rangeEnd: 2, method: 'direct_web', acquiredAt: 10, publicationEvidence: [] };
  const initial = content.saveMaterial(input).material;
  expect(() => content.saveMaterial({ ...input, text: '材料升级', rangeEnd: 4, acquiredAt: 20 })).toThrow();
  expect(content.readCurrentMaterial(initial.contentId)?.id).toBe(initial.id);
  expect(content.readMaterial('m2')).toBeUndefined();
});
it('rejects an analysis returned by an obsolete attempt token', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const contents = createMaterialStorage(database);
  const material = contents.saveMaterial({ platform: 'web', canonicalUrl: 'https://example.com/token', text: '实际材料', kind: 'full_text', truncated: false, rangeEnd: 4, method: 'direct_web', acquiredAt: 10, publicationEvidence: [] }).material;
  database.prepare({ sql: "INSERT INTO discovery_runs(id,purpose,status,interest_snapshot,config_revision,started_at,budget) VALUES('r1','candidate_supply','running','[]','v1',10,'{}')" }).run();
  database.prepare({ sql: "INSERT INTO content_analysis(content_id,material_id,contract_version,status,owner_run_id,attempt_token,attempt_started_at,attempt_deadline_at) VALUES(?,?,2,'running','r1','new-token',10,100)" }).run([material.contentId, material.id]);
  contents.saveAnalysis({ contentId: material.contentId, materialId: material.id, now: 30, attempt: { runId: 'r1', token: 'old-token', startedAt: 10, deadlineAt: 100 }, result: { summary: '实际材料', keyPoints: [{ text: '材料', evidence: [{ materialId: material.id, quote: '实际材料' }] }], topics: ['材料'], contentType: 'article', qualityScore: 0.5, spamScore: 0, timeScope: { kind: 'unknown', evidence: [] } } });
  expect(contents.readAnalysis(material.contentId, material.id)).toBeUndefined();
});
it('shares one analysis claim and prevents an earlier release from clearing a later claim', () => {
  database = createDatabase({ filename: ':memory:' }); folder = rehearsalFolder(); migrateDatabase({ database, migrationsFolder: folder });
  const contents = createMaterialStorage(database);
  const material = contents.saveMaterial({ platform: 'web', canonicalUrl: 'https://example.com/shared', text: '共同材料', kind: 'full_text', truncated: false, rangeEnd: 4, method: 'direct_web', acquiredAt: 10, publicationEvidence: [] }).material;
  for (const id of ['r1', 'r2']) database.prepare({ sql: "INSERT INTO discovery_runs(id,purpose,status,interest_snapshot,config_revision,started_at,budget) VALUES(?,'candidate_supply','running','[]','v1',10,'{}')" }).run([id]);
  const first = contents.claimAnalysis({ contentId: material.contentId, materialId: material.id, runId: 'r1', now: 20, deadlineAt: 100 })!;
  expect(first).toBeDefined();
  expect(contents.claimAnalysis({ contentId: material.contentId, materialId: material.id, runId: 'r2', now: 30, deadlineAt: 110 })).toBeUndefined();
  expect(contents.releaseAnalysis({ contentId: material.contentId, materialId: material.id, attempt: first, now: 30 })).toBe(true);
  const second = contents.claimAnalysis({ contentId: material.contentId, materialId: material.id, runId: 'r2', now: 40, deadlineAt: 120 })!;
  expect(second.token).not.toBe(first.token);
  expect(contents.releaseAnalysis({ contentId: material.contentId, materialId: material.id, attempt: first, now: 50 })).toBe(false);
  expect(contents.claimAnalysis({ contentId: material.contentId, materialId: material.id, runId: 'r1', now: 60, deadlineAt: 140 })).toBeUndefined();
});
