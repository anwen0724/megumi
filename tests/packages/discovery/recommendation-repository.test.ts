/* Verifies immutable Recommendation publication, mutable state, and reaction learning revisions. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createRecommendationRepository, createDiscoveryRepository, type RecommendationRepository } from '@megumi/discovery';

const snapshotAt = '2026-09-03T00:00:00.000Z';
const publishedAt = '2026-09-03T00:10:00.000Z';

describe('Recommendation repository', () => {
  let database: DatabaseConnection;
  let repository: RecommendationRepository;
  let nextId: number;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    database.prepare({ sql: "INSERT INTO discovery_interests (id,description,status,created_from,created_at,updated_at) VALUES ('interest:1','Agent architecture','active','manual',?,?)" }).run([snapshotAt, snapshotAt]);
    nextId = 0;
    repository = createRecommendationRepository({
      database,
      ids: { createId: () => `generated:${++nextId}` },
      clock: { now: () => publishedAt },
    });
    seedCandidate(database, 'candidate:1', 'identity:1', '2026-09-03T00:05:00.000Z');
    seedCandidate(database, 'candidate:2', 'identity:2', '2026-09-04T00:00:00.000Z');
  });

  afterEach(() => database.close());

  it('rejects stale user requirements without publishing or consuming a candidate', () => {
    const discovery = createDiscoveryRepository({ database });
    const guard = discovery.getPreferenceGuard();
    discovery.applyInterestChange({ action: 'update', interestId: 'interest:1', description: 'New explicit requirement', now: publishedAt });
    expect(repository.publish({ localDate: '2026-09-03', snapshotAt, publishedAt, preferenceGuard: guard, items: [publication('candidate:2', 'Source')] })).toEqual({ status: 'input_changed' });
    expect(repository.getCollection('2026-09-03')).toBeUndefined();
    expect(candidateStatus(database, 'candidate:2')).toBe('available');
    expect(repository.publish({ localDate: '2026-09-03', snapshotAt, publishedAt, preferenceGuard: discovery.getPreferenceGuard(), items: [publication('candidate:2', 'Source')] }).status).toBe('published');
  });

  it('admits the first feedback in a new scope but rejects its later correction', () => {
    const discovery = createDiscoveryRepository({ database });
    const first = repository.publish({ localDate: '2026-09-03', snapshotAt, publishedAt, items: [publication('candidate:1', 'Source')] });
    if (first.status !== 'published') throw new Error('Initial publication failed.');
    const recommendationId = first.collection.items[0].id;
    const guard = discovery.getPreferenceGuard();
    repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'liked' });
    expect(repository.publish({ localDate: '2026-09-04', snapshotAt, publishedAt, preferenceGuard: guard, items: [publication('candidate:2', 'Source')] }).status).toBe('published');
    seedCandidate(database, 'candidate:3', 'identity:3', '2026-09-10T00:00:00.000Z');
    const beforeCorrection = discovery.getPreferenceGuard();
    repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'disliked' });
    expect(repository.publish({ localDate: '2026-09-05', snapshotAt, publishedAt, preferenceGuard: beforeCorrection, items: [publication('candidate:3', 'Source')] }).status).toBe('input_changed');
    expect(candidateStatus(database, 'candidate:3')).toBe('available');
  });

  it('atomically publishes one immutable decision, content snapshot, and default state per Candidate', () => {
    const result = repository.publish({
      localDate: '2026-09-03',
      snapshotAt,
      publishedAt,
      items: [publication('candidate:1', 'Source One'), publication('candidate:2', 'Source Two')],
    });

    expect(result.status).toBe('published');
    if (result.status !== 'published') throw new Error('Expected publication to succeed.');
    expect(result.collection.items).toHaveLength(2);
    expect(result.collection.items[0]).toMatchObject({
      id: 'generated:1',
      candidateId: 'candidate:1',
      localDate: '2026-09-03',
      position: 0,
      recommendationReason: 'Matches the current Agent architecture interest.',
      content: {
        id: 'generated:2',
        sourceName: 'Source One',
        contentSummary: 'Summary candidate:1',
      },
      state: {
        id: 'generated:3',
        reactionRevision: 0,
        learnedReactionRevision: 0,
      },
    });
    expect(result.collection.items[1]?.position).toBe(1);
    expect(tableCount(database, 'discovery_recommendations')).toBe(2);
    expect(tableCount(database, 'discovery_recommendation_contents')).toBe(2);
    expect(tableCount(database, 'discovery_recommendation_states')).toBe(2);
    expect(candidateStatus(database, 'candidate:1')).toBe('consumed');
    expect(repository.getCollection('2026-09-03', true)).toEqual(result.collection);
  });

  it('uses snapshot-time expiry and rejects a consumed Candidate without partial publication', () => {
    expect(repository.publish({
      localDate: '2026-09-03', snapshotAt, publishedAt,
      items: [publication('candidate:1', 'Source One')],
    }).status).toBe('published');

    const result = repository.publish({
      localDate: '2026-09-04', snapshotAt, publishedAt,
      items: [publication('candidate:1', 'Source One'), publication('candidate:2', 'Source Two')],
    });

    expect(result).toEqual({ status: 'conflict', candidateIds: ['candidate:1'] });
    expect(repository.getCollection('2026-09-04', true)).toBeUndefined();
    expect(candidateStatus(database, 'candidate:2')).toBe('available');
  });

  it('updates only Recommendation State and exposes the current net Reaction change', () => {
    const published = repository.publish({
      localDate: '2026-09-03', snapshotAt, publishedAt,
      items: [publication('candidate:2', 'Source Two')],
    });
    if (published.status !== 'published') throw new Error('Expected publication to succeed.');
    const recommendationId = published.collection.items[0]!.id;

    expect(repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'liked' }))
      .toMatchObject({ status: 'updated', state: { reaction: 'liked', reactionRevision: 1 } });
    expect(repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'liked' }))
      .toMatchObject({ status: 'unchanged', state: { reactionRevision: 1 } });
    expect(repository.updateState({ recommendationId, action: 'set_favorite', favorite: true }))
      .toMatchObject({ status: 'updated', state: { favoriteAt: publishedAt } });

    expect(repository.listPendingReactionChanges({ limit: 20 })).toMatchObject([{
      recommendationId,
      currentReaction: 'liked',
      currentReactionRevision: 1,
      learnedReactionRevision: 0,
      content: { sourceName: 'Source Two' },
    }]);
    expect(repository.acknowledgeReactionLearned({
      recommendationId,
      expectedReactionRevision: 1,
      learnedReaction: 'liked',
    })).toEqual({ status: 'acknowledged' });
    expect(repository.listPendingReactionChanges({ limit: 20 })).toEqual([]);
  });

  it('preserves a newer Reaction when learning acknowledges an older revision', () => {
    const published = repository.publish({
      localDate: '2026-09-03', snapshotAt, publishedAt,
      items: [publication('candidate:2', 'Source Two')],
    });
    if (published.status !== 'published') throw new Error('Expected publication to succeed.');
    const recommendationId = published.collection.items[0]!.id;
    repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'liked' });
    repository.updateState({ recommendationId, action: 'set_reaction', reaction: 'disliked' });

    expect(repository.acknowledgeReactionLearned({
      recommendationId,
      expectedReactionRevision: 1,
      learnedReaction: 'liked',
    })).toEqual({ status: 'revision_conflict' });
    expect(repository.listPendingReactionChanges({ limit: 20 })[0]).toMatchObject({
      currentReaction: 'disliked', currentReactionRevision: 2, learnedReactionRevision: 0,
    });
  });
});

function publication(candidateId: string, sourceName: string) {
  return {
    candidateId,
    sourceName,
    recommendationReason: 'Matches the current Agent architecture interest.',
    selectionBasis: {
      primaryInterestId: 'interest:1',
      matchedInterestIds: ['interest:1'],
      interestRevisions: [{ interestId: 'interest:1', revision: 1 }],
      preferenceRevisions: [],
    },
  } as const;
}

function seedCandidate(
  database: DatabaseConnection,
  candidateId: string,
  contentIdentity: string,
  expiresAt: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'source:1', ?, 'article', ?, ?, 0, 'available', ?, ?)
  ` }).run([
    candidateId,
    contentIdentity,
    `https://example.com/${candidateId}`,
    `Title ${candidateId}`,
    `Summary ${candidateId}`,
    '2026-09-02T00:00:00.000Z',
    expiresAt,
  ]);
}

function tableCount(database: DatabaseConnection, table: string): number {
  return database.prepare<{ count: number }>({ sql: `SELECT COUNT(*) AS count FROM ${table}` }).get()!.count;
}

function candidateStatus(database: DatabaseConnection, candidateId: string): string {
  return database.prepare<{ status: string }>({
    sql: 'SELECT status FROM discovery_candidates WHERE id = ?',
  }).get([candidateId])!.status;
}
