/* Rehearses the pending recommendation migration with isolated SQLite databases. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { rehearsalFolder } from './foundation-fixture';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import { afterEach, expect, it } from 'vitest';
const directories: string[] = [];
const databases: DatabaseConnection[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

it('preserves legacy material and marks old qualification stale without inventing publication evidence', () => {
  const database = createDatabase({ filename: ':memory:' }); databases.push(database);
  migrateDatabase({ database });
  database.prepare({
    sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','原文',1,10,20)"
  }).run();
  database.prepare({
    sql: "INSERT INTO contents(id,source,canonical_url,title,text,language,published_at,created_at,updated_at) VALUES('c1','zhihu','https://zhihu.com/1','标题','旧材料','zh',100,10,20)"
  }).run();
  database.prepare({
    sql: "INSERT INTO content_interest_matches(content_id,interest_id,relation,basis,matched_at) VALUES('c1','i1','direct','旧依据',20)"
  }).run();
  database.prepare({
    sql: "INSERT INTO recommendation_candidates(pool,content_id,status,created_at,updated_at) VALUES('daily','c1','active',10,20)"
  }).run();
  const migrationsFolder = rehearsalFolder(); directories.push(migrationsFolder);
  migrateDatabase({ database, migrationsFolder });
  expect(database.prepare({ sql: 'SELECT text,kind,publication_evidence FROM content_materials' }).all()).toEqual([{
    text: '旧材料',
    kind: 'excerpt',
    publication_evidence: expect.stringContaining('modified')
  }]);
  expect(database.prepare({ sql: 'SELECT status,basis FROM recommendation_candidates' }).all()).toEqual([{ status: 'stale', basis: '旧依据' }]);
  expect(createMaterialStorage(database).readMaterial('legacy:c1')).toMatchObject({ text: '旧材料', language: 'zh', publicationEvidence: [{ kind: 'modified', status: 'unverified' }] });
  expect(database.prepare({ sql: 'SELECT text_hash FROM content_materials' }).get()).toEqual({ text_hash: '5ec0879d82292f629df74be17d342d9f9db4fc0d70517b234e9357a40dbf3ca4' });
  expect(migrateDatabase({ database, migrationsFolder }).appliedMigrations).toBe(0);
});

it('protects immutable material referenced by a favorite even after interest deletion', () => {
  const database = openFoundation();
  const material = createMaterialStorage(database).saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/1',
    text: '材料',
    kind: 'full_text',
    truncated: false,
    rangeEnd: 2,
    method: 'direct_web',
    acquiredAt: 10,
    publicationEvidence: []
  }).material;
  database.prepare({
    sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','原文',1,0,0)"
  }).run();
  database.prepare({
    sql: 'INSERT INTO favorites(content_id,material_id,title_snapshot,created_at) VALUES(?,?,?,?)'
  }).run([material.contentId, material.id, '标题', 10]);
  database.prepare({ sql: "DELETE FROM interests WHERE id = 'i1'" }).run();
  expect(() => database.prepare({ sql: 'UPDATE content_materials SET text = ? WHERE id = ?' }).run(['篡改', material.id])).toThrow();
  expect(() => database.prepare({ sql: 'DELETE FROM content_materials WHERE id = ?' }).run([material.id])).toThrow();
  expect(() => database.prepare({ sql: 'DELETE FROM contents WHERE id = ?' }).run([material.contentId])).toThrow();
  expect(database.prepare({ sql: 'SELECT title_snapshot FROM favorites' }).all()).toEqual([{ title_snapshot: '标题' }]);
});

it('requires complete attempt ownership and one active material request per method', () => {
  const database = openFoundation();
  database.prepare({
    sql: "INSERT INTO contents(id,platform,canonical_url,created_at,updated_at) VALUES('c1','web','https://example.com/1',0,0)"
  }).run();
  expect(() => database.prepare({
    sql: "INSERT INTO material_requests(id,content_id,method,request_url,status,attempt_token) VALUES('r0','c1','direct_web','https://example.com/1','running','orphan')"
  }).run()).toThrow();
  database.prepare({
    sql: "INSERT INTO material_requests(id,content_id,method,request_url,status) VALUES('r1','c1','direct_web','https://example.com/1','pending')"
  }).run();
  expect(() => database.prepare({
    sql: "INSERT INTO material_requests(id,content_id,method,request_url,status) VALUES('r2','c1','direct_web','https://example.com/1','pending')"
  }).run()).toThrow();
  expect(database.prepare({ sql: 'SELECT id FROM material_requests' }).all()).toEqual([{ id: 'r1' }]);
});

it('merges legacy search results for one platform identity without inventing search history links', () => {
  const database = createDatabase({ filename: ':memory:' }); databases.push(database); migrateDatabase({ database });
  const insert = "INSERT INTO search_results(id,source,external_id,url,first_seen_at,last_seen_at) VALUES(?,'zhihu','answer:1',?,?,?)";
  database.prepare({ sql: insert }).run(['r1', 'https://www.zhihu.com/question/1/answer/1', 10, 20]);
  database.prepare({ sql: insert }).run(['r2', 'https://www.zhihu.com/answer/1', 15, 30]);
  const folder = rehearsalFolder(); directories.push(folder);
  migrateDatabase({ database, migrationsFolder: folder });
  expect(database.prepare({ sql: 'SELECT external_id,first_seen_at,last_seen_at FROM search_results' }).all()).toEqual([{ external_id: 'answer:1', first_seen_at: 10, last_seen_at: 30 }]);
  expect(database.prepare({ sql: 'SELECT * FROM search_result_links' }).all()).toEqual([]);
});

it('rolls back result rows and the current pointer together when a referenced material is absent', () => {
  const database = openFoundation();
  database.prepare({ sql: "INSERT INTO curated_selections VALUES('old','[]',0,'ready')" }).run();
  database.prepare({ sql: "UPDATE recommendation_state SET current_selection_id = 'old' WHERE id = 1" }).run();
  expect(() => database.transaction({
    operation: () => {
      database.prepare({ sql: "INSERT INTO curated_selections VALUES('new','[]',10,'ready')" }).run();
      database.prepare({ sql: "UPDATE recommendation_state SET current_selection_id = 'new' WHERE id = 1" }).run();
      database.prepare({
        sql: "INSERT INTO curated_selection_items VALUES('new','missing','missing',0,'[]','理由','[]')"
      }).run();
    }
  })).toThrow();
  expect(database.prepare({ sql: 'SELECT current_selection_id FROM recommendation_state' }).all()).toEqual([{ current_selection_id: 'old' }]);
  expect(database.prepare({ sql: 'SELECT id FROM curated_selections' }).all()).toEqual([{ id: 'old' }]);
});

it('enforces daily batch, run request and per-item judgment uniqueness', () => {
  const database = openFoundation();
  const batch = "INSERT INTO daily_feed_batches(id,date,timezone,interest_id,interest_revision,interest_text,window_start,window_end,status,committed_at) VALUES(?,'2026-10-07','Asia/Shanghai','i1',1,'原文',0,10,'empty',10)";
  database.prepare({ sql: batch }).run(['b1']);
  expect(() => database.prepare({ sql: batch }).run(['b2'])).toThrow();
  const run = "INSERT INTO recommendation_runs(id,kind,request_id,input_hash,status,interest_snapshot,candidate_snapshot,started_at,daily_feed_batch_id) VALUES(?,'daily_feed','request1','hash','completed','[]','[]',0,'b1')";
  database.prepare({ sql: run }).run(['run1']);
  expect(() => database.prepare({ sql: run }).run(['run2'])).toThrow();
  expect(() => database.prepare({
    sql: "UPDATE recommendation_runs SET daily_feed_batch_id = 'missing' WHERE id = 'run1'"
  }).run()).toThrow();
  const material = createMaterialStorage(database).saveMaterial({
    platform: 'web',
    canonicalUrl: 'https://example.com/1',
    text: '材料',
    kind: 'excerpt',
    truncated: false,
    rangeEnd: 2,
    method: 'direct_web',
    acquiredAt: 10,
    publicationEvidence: []
  }).material;
  const judgment = 'INSERT INTO recommendation_run_judgments(run_id,stage,content_id,interest_id,material_id,input_hash,status) VALUES(?,?,?,?,?,?,?)';
  const values = ['run1', 'topic', material.contentId, 'i1', material.id, 'hash', 'pending'];
  database.prepare({ sql: judgment }).run(values);
  expect(() => database.prepare({ sql: judgment }).run(values)).toThrow();
});

it('upgrades a copy at 0030, rolls back interruption, and preserves unrelated records on retry', () => {
  const folder = rehearsalFolder(); directories.push(folder);
  const journalPath = path.join(folder, 'meta/_journal.json');
  const journalText = fs.readFileSync(journalPath, 'utf8');
  const journal = JSON.parse(journalText); journal.entries = journal.entries.slice(0, 31);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  const originalPath = path.join(folder, 'original.sqlite3');
  const original = createDatabase({ filename: originalPath });
  migrateDatabase({ database: original, migrationsFolder: folder });
  original.prepare({
    sql: "INSERT INTO interests(id,text,enabled,created_at,updated_at) VALUES('i1','原文',0,10,20)"
  }).run();
  original.prepare({
    sql: "INSERT INTO skill_availability VALUES('skill1','/skills/one',1,'2026-10-07T00:00:00Z')"
  }).run();
  original.close();
  const copyPath = path.join(folder, 'copy.sqlite3'); fs.copyFileSync(originalPath, copyPath);
  const database = createDatabase({ filename: copyPath }); databases.push(database);
  fs.writeFileSync(journalPath, journalText);
  const pendingPath = path.join(folder, '0033_recommendation_foundation.sql');
  const sql = fs.readFileSync(pendingPath, 'utf8');
  fs.writeFileSync(pendingPath, `${sql}\n--> statement-breakpoint\nSELECT * FROM deliberately_missing_table;`);
  expect(() => migrateDatabase({ database, migrationsFolder: folder })).toThrow();
  expect(database.prepare({ sql: 'SELECT text,enabled FROM interests' }).all()).toEqual([{ text: '原文', enabled: 0 }]);
  expect(database.prepare({
    sql: "SELECT count(*) AS count FROM sqlite_master WHERE name = 'content_materials'"
  }).get()).toEqual({ count: 0 });
  fs.writeFileSync(pendingPath, sql);
  migrateDatabase({ database, migrationsFolder: folder });
  expect(database.prepare({ sql: 'SELECT text,revision,created_at,updated_at FROM interests' }).all()).toEqual([{ text: '原文', revision: 1, created_at: 10, updated_at: 20 }]);
  expect(database.prepare({ sql: 'SELECT skill_path FROM skill_availability' }).all()).toEqual([{ skill_path: '/skills/one' }]);
  expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
  expect(migrateDatabase({ database, migrationsFolder: folder }).appliedMigrations).toBe(0);
});

/** Opens the target schema only in an isolated test database. */
function openFoundation(): DatabaseConnection {
  const database = createDatabase({ filename: ':memory:' }); databases.push(database);
  const folder = rehearsalFolder(); directories.push(folder);
  migrateDatabase({ database, migrationsFolder: folder });
  return database;
}
