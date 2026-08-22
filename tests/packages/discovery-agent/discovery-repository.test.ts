/* Verifies DiscoveryRepository's business surface and atomic batch publication. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery-agent';

const now = '2026-08-22T00:00:00.000Z';

describe('DiscoveryRepository foundation', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });
  afterEach(() => database.close());

  it('exposes business operations instead of generic CRUD', () => {
    const repository = createDiscoveryRepository({ database });
    for (const genericOperation of ['insert', 'update', 'delete', 'find', 'query', 'transaction']) {
      expect(repository).not.toHaveProperty(genericOperation);
    }
    expect(repository).toHaveProperty('claimDailyBatch');
    expect(repository).toHaveProperty('publishDailyBatch');
  });

  it('rolls back every Recommendation and leaves the batch running when publication conflicts', () => {
    const repository = createDiscoveryRepository({ database });
    const claimed = repository.claimDailyBatch({
      batchId: 'batch:1',
      localDate: '2026-08-22',
      timezone: 'Asia/Shanghai',
      executionId: 'execution:1',
      targetCount: 20,
      now,
    });
    expect(claimed.status).toBe('claimed');

    const result = repository.publishDailyBatch({
      batchId: 'batch:1',
      executionId: 'execution:1',
      publishedAt: now,
      recommendations: [
        recommendation('recommendation:1', 'same-identity', 0),
        recommendation('recommendation:2', 'same-identity', 1),
      ],
    });

    expect(result).toMatchObject({ status: 'conflict' });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_recommendations',
    }).get()?.count).toBe(0);
    expect(database.prepare<{ status: string; result_count: number }>({
      sql: 'SELECT status, result_count FROM discovery_batches WHERE batch_id = ?',
    }).get(['batch:1'])).toEqual({ status: 'running', result_count: 0 });
  });

  it('publishes the Recommendation set and batch state in one transaction', () => {
    const repository = createDiscoveryRepository({ database });
    repository.claimDailyBatch({
      batchId: 'batch:1',
      localDate: '2026-08-22',
      timezone: 'Asia/Shanghai',
      executionId: 'execution:1',
      targetCount: 20,
      now,
    });

    const result = repository.publishDailyBatch({
      batchId: 'batch:1',
      executionId: 'execution:1',
      publishedAt: now,
      recommendations: [
        recommendation('recommendation:1', 'identity:1', 0),
        recommendation('recommendation:2', 'identity:2', 1),
      ],
    });

    expect(result).toMatchObject({
      status: 'published',
      batch: { status: 'published', resultCount: 2 },
    });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_recommendations',
    }).get()?.count).toBe(2);
  });
});

function recommendation(recommendationId: string, contentIdentity: string, position: number) {
  return {
    recommendationId,
    batchId: 'batch:1',
    contentIdentity,
    position,
    sourceId: 'custom_source',
    sourceName: 'Custom',
    canonicalUrl: `https://example.com/${recommendationId}`,
    contentType: 'article' as const,
    title: recommendationId,
    recommendationReason: 'Relevant.',
    publishedAt: now,
  };
}
