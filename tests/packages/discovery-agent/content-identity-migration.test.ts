/* Verifies the idempotent historical Recommendation identity migration. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery-agent';

describe('Recommendation content identity migration', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedDuplicateHistory(database);
  });
  afterEach(() => database.close());

  it('keeps the earliest card canonical and preserves later duplicate history', () => {
    const repository = createDiscoveryRepository({ database });

    expect(repository.migrateRecommendationIdentities()).toEqual({ migrated: 2, duplicates: 1 });
    expect(repository.migrateRecommendationIdentities()).toEqual({ migrated: 0, duplicates: 0 });

    expect(database.prepare<{ recommendation_id: string; content_identity: string }>({ sql: `
      SELECT recommendation_id, content_identity FROM discovery_recommendations ORDER BY recommendation_id
    ` }).all()).toEqual([
      { recommendation_id: 'recommendation:1', content_identity: 'content:v2:platform:zhihu:answer:456' },
      { recommendation_id: 'recommendation:2', content_identity: 'content:legacy-duplicate:recommendation:2' },
    ]);
  });
});

function seedDuplicateHistory(database: DatabaseConnection): void {
  for (const [index, localDate] of ['2026-08-22', '2026-08-23'].entries()) {
    database.prepare({ sql: `
      INSERT INTO discovery_batches (
        batch_id, local_date, timezone, status, execution_id, target_count,
        attempt_count, automatic_retry_count, result_count,
        created_at, updated_at, started_at, published_at
      ) VALUES (?, ?, 'Asia/Shanghai', 'published', ?, 20, 1, 0, 1, ?, ?, ?, ?)
    ` }).run([
      `batch:${index + 1}`, localDate, `execution:${index + 1}`,
      `${localDate}T00:00:00.000Z`, `${localDate}T00:00:00.000Z`,
      `${localDate}T00:00:00.000Z`, `${localDate}T00:00:00.000Z`,
    ]);
  }
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, recommendation_reason, published_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'article', 'Relevant', ?)
  ` }).run([
    'recommendation:1', 'batch:1', 'open_web:url:old', 'open_web', 'zhihu.com',
    'https://www.zhihu.com/question/123/answer/456?utm_source=web', 'First', '2026-08-22T00:00:00.000Z',
  ]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, recommendation_reason, published_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'article', 'Relevant', ?)
  ` }).run([
    'recommendation:2', 'batch:2', 'zhihu:id:answer:456', 'zhihu', '知乎',
    'https://www.zhihu.com/question/123/answer/456', 'Second', '2026-08-23T00:00:00.000Z',
  ]);
}
