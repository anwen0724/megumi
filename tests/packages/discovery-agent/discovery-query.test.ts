/* Verifies durable Home/search projections and idempotent Recommendation state updates. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery-agent';

const now = '2026-08-22T10:00:00.000Z';

describe('DiscoveryRepository Home and Recommendation queries', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seed(database);
  });
  afterEach(() => database.close());

  it('reads visible timeline pages in stable date/position order and groups them by day', () => {
    const repository = createDiscoveryRepository({ database });

    const first = repository.readHome({
      mode: 'timeline', localDate: '2026-08-22', limit: 2,
      nextScheduledAt: '2026-08-23T00:00:00.000Z',
    });
    expect(first.today).toMatchObject({ localDate: '2026-08-22', status: 'published', resultCount: 2 });
    expect(first.days.map((day) => [day.localDate, day.recommendations.map((item) => item.title)]))
      .toEqual([
        ['2026-08-22', ['Today first', 'Today second']],
      ]);
    expect(first.interests.map((item) => item.description)).toEqual(['Agent', '美食']);
    expect(first.favoriteCount).toBe(2);
    expect(first.watchLaterCount).toBe(1);
    expect(first.nextScheduledAt).toBe('2026-08-23T00:00:00.000Z');
    expect(first.nextCursor).toBeTruthy();

    const second = repository.readHome({
      mode: 'timeline', localDate: '2026-08-22', cursor: first.nextCursor, limit: 2,
    });
    expect(second.days.flatMap((day) => day.recommendations.map((item) => item.title)))
      .toEqual(['Yesterday favorite']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('filters favorites/watch later and excludes hidden Recommendations from every mode', () => {
    const repository = createDiscoveryRepository({ database });

    expect(repository.readHome({ mode: 'favorites', localDate: '2026-08-22' })
      .days.flatMap((day) => day.recommendations.map((item) => item.title)))
      .toEqual(['Today first', 'Yesterday favorite']);
    expect(repository.readHome({ mode: 'watch_later', localDate: '2026-08-22' })
      .days.flatMap((day) => day.recommendations.map((item) => item.title)))
      .toEqual(['Today second']);
  });

  it('searches only local published snapshots across title, author, source, description and reason', () => {
    const repository = createDiscoveryRepository({ database });

    expect(repository.searchRecommendations({ query: 'practical', limit: 30 }).recommendations.map((item) => item.title))
      .toEqual(['Today first']);
    expect(repository.searchRecommendations({ query: 'Bob', limit: 30 }).recommendations.map((item) => item.title))
      .toEqual(['Today second']);
    expect(repository.searchRecommendations({ query: 'hidden keyword', limit: 30 }).recommendations)
      .toEqual([]);
  });

  it('resolves only published, visible Recommendations as conversation authority', () => {
    const repository = createDiscoveryRepository({ database });
    expect(repository.readRecommendationReference('recommendation:today:1')).toMatchObject({
      type: 'recommendation_reference', recommendationId: 'recommendation:today:1', title: 'Today first',
    });
    expect(repository.readRecommendationReference('recommendation:hidden')).toBeUndefined();
    expect(repository.readRecommendationReference('recommendation:missing')).toBeUndefined();
  });

  it('updates current state by target value and preserves first-opened time', () => {
    const repository = createDiscoveryRepository({ database });

    const opened = repository.updateRecommendationState({
      recommendationId: 'recommendation:today:1', action: 'opened', now,
    });
    const openedAgain = repository.updateRecommendationState({
      recommendationId: 'recommendation:today:1', action: 'opened', now: '2026-08-22T11:00:00.000Z',
    });
    expect(opened).toMatchObject({ firstOpenedAt: now, lastOpenedAt: now });
    expect(openedAgain).toMatchObject({ firstOpenedAt: now, lastOpenedAt: '2026-08-22T11:00:00.000Z' });

    expect(repository.updateRecommendationState({
      recommendationId: 'recommendation:today:1', action: 'set_reaction', reaction: 'liked', now,
    }).reaction).toBe('liked');
    expect(repository.updateRecommendationState({
      recommendationId: 'recommendation:today:1', action: 'set_favorite', favorite: false, now,
    }).favorite).toBe(false);
    expect(repository.updateRecommendationState({
      recommendationId: 'recommendation:today:1', action: 'set_hidden', hidden: true, now,
    }).hidden).toBe(true);
  });
});

function seed(database: DatabaseConnection) {
  database.prepare({ sql: `
    INSERT INTO discovery_interests (
      interest_id, description, status, created_from, created_at, updated_at
    ) VALUES
      ('interest:1', 'Agent', 'active', 'manual', ?, ?),
      ('interest:2', '美食', 'paused', 'conversation', ?, ?)
  ` }).run([now, now, now, now]);
  insertBatch(database, 'batch:today', '2026-08-22', 2);
  insertBatch(database, 'batch:yesterday', '2026-08-21', 2);
  insertRecommendation(database, {
    id: 'recommendation:today:1', batch: 'batch:today', identity: 'one', position: 0,
    title: 'Today first', author: 'Alice', description: 'Deep implementation', reason: 'practical guide',
    favorite: now,
  });
  insertRecommendation(database, {
    id: 'recommendation:today:2', batch: 'batch:today', identity: 'two', position: 1,
    title: 'Today second', author: 'Bob', description: 'Recruitment', reason: 'timely',
    watchLater: now,
  });
  insertRecommendation(database, {
    id: 'recommendation:yesterday:1', batch: 'batch:yesterday', identity: 'three', position: 0,
    title: 'Yesterday favorite', author: 'Carol', description: 'Recipe', reason: 'new dish',
    favorite: now,
  });
  insertRecommendation(database, {
    id: 'recommendation:hidden', batch: 'batch:yesterday', identity: 'hidden', position: 1,
    title: 'Hidden', author: 'Nobody', description: 'hidden keyword', reason: 'hidden keyword',
    hidden: now,
  });
}

function insertBatch(database: DatabaseConnection, id: string, localDate: string, resultCount: number) {
  database.prepare({ sql: `
    INSERT INTO discovery_batches (
      batch_id, local_date, timezone, status, execution_id, target_count,
      attempt_count, automatic_retry_count, result_count, created_at, updated_at, started_at, published_at
    ) VALUES (?, ?, 'Asia/Shanghai', 'published', ?, 20, 1, 0, ?, ?, ?, ?, ?)
  ` }).run([id, localDate, `execution:${id}`, resultCount, now, now, now, now]);
}

function insertRecommendation(database: DatabaseConnection, input: {
  id: string; batch: string; identity: string; position: number; title: string;
  author: string; description: string; reason: string;
  hidden?: string; favorite?: string; watchLater?: string;
}) {
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, author, description, recommendation_reason,
      hidden_at, favorite_at, watch_later_at, published_at
    ) VALUES (?, ?, ?, ?, 'open_web', 'example.com', ?, ?, 'article', ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    input.id, input.batch, input.identity, input.position, `https://example.com/${input.identity}`,
    input.title, input.author, input.description, input.reason,
    input.hidden ?? null, input.favorite ?? null, input.watchLater ?? null, now,
  ]);
}
