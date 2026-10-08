/* Verifies production migrations and Content retain material boundaries and date evidence. */
// @vitest-environment node
import { expect, it, onTestFinished } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';
import { createSourceAccess } from '@megumi/application/recommendation/sources/source-access';
import { rehearsalFolder, legacyMigrationFolder } from './foundation-fixture';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';

it('persists extracted text with its actual range and date claims in the production schema', async () => {
  const database = createDatabase({ filename: ':memory:' });

  try {
    migrateDatabase({ database });
    const access = createSourceAccess({
      enabledSources: () => ['tavily'],
      accessSecret: () => 'secret',

      fetch: async input =>
        new URL(String(input)).pathname === '/search'
          ? Response.json({
              results: [
                {
                  title: '面试',
                  url: 'https://example.com/interview',
                  content: '搜索摘要',
                  published_date: '2026-10-06',
                },
              ],
            })
          : Response.json({
              results: [
                {
                  url: 'https://example.com/interview',
                  raw_content: '正文🌏',
                },
              ],
              failed_results: [],
            }),
    });
    const searched = await access.connectors()[0]!.search({
      query: '面试',
      limit: 5,
    });
    if (searched.status !== 'success' || !searched.items[0])
      throw new Error('Expected search material');

    const item = searched.items[0];
    const fetched = await access.acquireMaterial(item);
    if (fetched.status !== 'success') throw new Error('Expected extracted material');

    const contents = createMaterialStorage(database);
    const content = contents.saveMaterial({
      platform: 'web',
      canonicalUrl: item.url,
      text: fetched.material.text,
      kind: 'full_text',
      method: 'tavily_extract',
      truncated: false,
      rangeEnd: 3,
      acquiredAt: 1700000000000,
      publicationEvidence: item.publicationEvidence ?? [],
    }).material;

    expect(contents.readCurrentMaterial(content.contentId)).toMatchObject({
      text: '正文🌏',
      revision: 1,
      kind: 'full_text',
      rangeEnd: 3,
      method: 'tavily_extract',
      publicationEvidence: [
        {
          status: 'unverified',
          location: 'Tavily.results.published_date',
        },
      ],
    });
  } finally {
    database.close();
  }
});

it('backfills old text without promoting legacy timestamps to verified publication dates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-material-migration-'));
  const database = createDatabase({ filename: ':memory:' });
  onTestFinished(() => {
    database.close();
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  });
  fs.cpSync(path.resolve('packages/application/resources/migrations'), directory, {
    recursive: true,
  });
  const journalPath = path.join(directory, 'meta/_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  fs.writeFileSync(
    journalPath,
    JSON.stringify({
      ...journal,
      entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 33),
    }),
  );
  migrateDatabase({
    database,
    migrationsFolder: directory,
  });
  database
    .prepare({
      sql: "INSERT INTO contents(id,source,canonical_url,text,published_at,created_at,updated_at) VALUES('legacy-1','zhihu','https://zhuanlan.zhihu.com/p/123','旧材料🌏',100,10,20)",
    })
    .run();
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  migrateDatabase({
    database,
    migrationsFolder: directory,
  });

  expect(createMaterialStorage(database).readCurrentMaterial('legacy-1')).toMatchObject({
    text: '旧材料🌏',
    kind: 'excerpt',
    rangeEnd: 4,
    publicationEvidence: [
      {
        kind: 'modified',
        status: 'unverified',
      },
    ],
  });
});

it('preserves acquired material versions when the later foundation migration switches consumers', () => {
  const database = createDatabase({ filename: ':memory:' });
  const folder = rehearsalFolder();
  onTestFinished(() => {
    database.close();
    fs.rmSync(folder, {
      recursive: true,
      force: true,
    });
  });
  migrateDatabase({
    database,
    migrationsFolder: legacyMigrationFolder(),
  });
  database
    .prepare({
      sql: "INSERT INTO contents(id,source,platform,external_id,canonical_url,text,created_at,updated_at) VALUES('c1','zhihu','zhihu','123','https://zhuanlan.zhihu.com/p/123','摘要',10,10)",
    })
    .run();

  // Seed the historical schema directly; today's writer must not support a retired schema.
  const original = { id: 'original-material' };
  const full = { id: 'full-material' };
  for (const [id, revision, text, kind, method, time] of [
    [original.id, 1, '摘要', 'excerpt', 'zhihu_search', 10],
    [full.id, 2, '完整正文', 'full_text', 'zhihu_browser_detail', 20],
  ] as const) {
    database
      .prepare({
        sql: "INSERT INTO content_materials(id,content_id,revision,text,text_hash,kind,truncated,range_end,method,acquired_at,publication_evidence) VALUES(?,'c1',?,?,sha256(?),?,0,?,?,?,'[]')",
      })
      .run([id, revision, text, text, kind, [...text].length, method, time]);
    database
      .prepare({
        sql: 'INSERT INTO material_acquisitions(id,material_id,method,acquired_at) VALUES(?,?,?,?)',
      })
      .run(['acquisition-' + id, id, method, time]);
  }

  database
    .prepare({ sql: "UPDATE contents SET current_material_id=?,text='完整正文' WHERE id='c1'" })
    .run([full.id]);
  migrateDatabase({
    database,
    migrationsFolder: folder,
  });

  const materials = createMaterialStorage(database);

  expect(materials.readCurrentMaterial('c1')).toMatchObject({
    id: full.id,
    revision: 2,
    text: '完整正文',
  });
  expect(original && materials.readMaterial(original.id)).toMatchObject({
    text: '摘要',
    revision: 1,
  });
  expect(
    database.prepare({ sql: 'SELECT count(*) AS count FROM material_acquisitions' }).get(),
  ).toEqual({ count: 2 });
});

it('preserves platform identity and access URL when discoveries from two services migrate', () => {
  const database = createDatabase({ filename: ':memory:' });
  const folder = rehearsalFolder();
  onTestFinished(() => {
    database.close();
    fs.rmSync(folder, {
      recursive: true,
      force: true,
    });
  });
  migrateDatabase({
    database,
    migrationsFolder: legacyMigrationFolder(),
  });
  for (const [source, seen] of [
    ['tavily', 10],
    ['bing_rss', 20],
  ] as const) {
    const item = {
      source,
      platform: 'xiaohongshu',
      externalId: 'note1',
      url: 'https://www.xiaohongshu.com/explore/note1',
      requestUrl: 'https://www.xiaohongshu.com/explore/note1?xsec_token=local',
      text: '片段',
      kind: 'excerpt',
      method: source,
      publicationEvidence: [],
    };
    database
      .prepare({
        sql: 'INSERT INTO search_results(id,source,external_id,url,description,raw_payload,status,attempts,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,0,?,?)',
      })
      .run([
        source,
        source,
        item.externalId,
        item.url,
        item.text,
        JSON.stringify(item),
        'pending',
        seen,
        seen,
      ]);
  }

  migrateDatabase({
    database,
    migrationsFolder: folder,
  });

  expect(
    database
      .prepare({
        sql: 'SELECT platform,source_id,external_id,request_url,publication_evidence,first_seen_at FROM search_results',
      })
      .all(),
  ).toEqual([
    {
      platform: 'xiaohongshu',
      source_id: 'bing_rss',
      external_id: 'note1',
      request_url: 'https://www.xiaohongshu.com/explore/note1?xsec_token=local',
      publication_evidence: '[]',
      first_seen_at: 10,
    },
  ]);
});
