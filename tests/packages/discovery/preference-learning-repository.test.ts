/* Verifies Reaction revision learning, durable batches, and atomic Preference revisions. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository, type DiscoveryRepository } from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';
const databases: DatabaseConnection[] = [];

describe('Preference learning repository', () => {
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('triggers immediately at three pending Reaction revisions', () => {
    const { database, repository } = setup();
    for (let index = 1; index <= 3; index += 1) {
      seedRecommendation(database, index);
      setReaction(database, index, 'liked');
    }

    expect(repository.getPreferenceLearningTrigger({ now })).toEqual({
      status: 'ready',
      reason: 'threshold',
      pendingReactionCount: 3,
    });
  });

  it('schedules one or two Reaction revisions for the oldest ten-minute deadline', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(database, 1, 'liked');

    expect(repository.getPreferenceLearningTrigger({ now })).toEqual({
      status: 'scheduled',
      pendingReactionCount: 1,
      dueAt: '2026-08-27T08:10:00.000Z',
    });
    expect(repository.getPreferenceLearningTrigger({ now: '2026-08-27T08:10:00.000Z' })).toEqual({
      status: 'ready',
      reason: 'deadline',
      pendingReactionCount: 1,
    });
  });

  it('claims a fixed batch and atomically commits a complete Preference revision', () => {
    const { database, repository } = setup();
    for (let index = 1; index <= 3; index += 1) {
      seedRecommendation(database, index);
      setReaction(database, index, 'liked');
    }
    const batch = repository.claimPreferenceLearningBatch({
      batchId: 'preference-batch:1',
      reason: 'threshold',
      now,
      limit: 20,
    });
    expect(batch?.status).toBe('running');
    const facts = repository.getPreferenceLearningFacts('preference-batch:1');
    expect(facts?.reactionChanges).toHaveLength(3);
    expect(facts?.affectedScopes).toEqual([{
      scopeKey: 'interest:interest:agents',
      scope: 'interest',
      interestId: 'interest:agents',
      baseRevision: 0,
    }]);

    const committed = repository.commitPreferenceLearningBatch({
      batchId: 'preference-batch:1',
      committedAt: now,
      scopes: [{
        scopeKey: 'interest:interest:agents',
        baseRevision: 0,
        directions: [{
          directionId: 'preference-direction:1',
          polarity: 'positive',
          dimension: 'topic',
          statement: '更关注 Agent Runtime 的工程实现。',
          supportingRecommendationIds: ['recommendation:1', 'recommendation:2', 'recommendation:3'],
        }],
      }],
    });

    expect(committed).toEqual({
      status: 'committed',
      revisions: [{ scopeKey: 'interest:interest:agents', revision: 1 }],
      affectedInterestIds: ['interest:agents'],
    });
    expect(repository.listPreferenceSnapshots()).toEqual([{
      scopeKey: 'interest:interest:agents',
      scope: 'interest',
      interestId: 'interest:agents',
      revision: 1,
      directions: [{
        directionId: 'preference-direction:1',
        polarity: 'positive',
        dimension: 'topic',
        statement: '更关注 Agent Runtime 的工程实现。',
        supportingRecommendationIds: ['recommendation:1', 'recommendation:2', 'recommendation:3'],
        updatedAt: now,
      }],
      updatedAt: now,
    }]);
    expect(repository.getPreferenceLearningTrigger({ now })).toEqual({ status: 'idle' });
  });

  it('rejects invalid evidence without partially advancing the batch', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(database, 1, 'liked');
    repository.claimPreferenceLearningBatch({
      batchId: 'preference-batch:1', reason: 'deadline', now: '2026-08-27T08:10:00.000Z', limit: 20,
    });

    const result = repository.commitPreferenceLearningBatch({
      batchId: 'preference-batch:1',
      committedAt: '2026-08-27T08:10:01.000Z',
      scopes: [{
        scopeKey: 'interest:interest:agents',
        baseRevision: 0,
        directions: [{
          directionId: 'preference-direction:1',
          polarity: 'positive',
          dimension: 'topic',
          statement: '无效证据不应提交。',
          supportingRecommendationIds: ['recommendation:outside-batch'],
        }],
      }],
    });

    expect(result).toEqual({ status: 'rejected', reason: 'invalid_recommendation_reference' });
    expect(repository.listPreferenceSnapshots()).toEqual([]);
    expect(database.prepare<{ status: string }>({
      sql: 'SELECT status FROM discovery_preference_learning_batches WHERE batch_id = ?',
    }).get(['preference-batch:1'])?.status).toBe('running');
  });

  it('makes a learned Reaction switch immediately ready for correction', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(database, 1, 'liked');
    repository.claimPreferenceLearningBatch({
      batchId: 'preference-batch:1', reason: 'deadline', now: '2026-08-27T08:10:00.000Z', limit: 20,
    });
    repository.commitPreferenceLearningBatch({
      batchId: 'preference-batch:1', committedAt: '2026-08-27T08:10:01.000Z',
      scopes: [{
        scopeKey: 'interest:interest:agents', baseRevision: 0,
        directions: [{
          directionId: 'preference-direction:1', polarity: 'positive', dimension: 'topic',
          statement: '关注 Agent Runtime。', supportingRecommendationIds: ['recommendation:1'],
        }],
      }],
    });

    setReaction(database, 1, 'disliked', '2026-08-27T08:11:00.000Z');

    expect(repository.getPreferenceLearningTrigger({ now: '2026-08-27T08:11:00.000Z' })).toEqual({
      status: 'ready', reason: 'correction', pendingReactionCount: 1,
    });
  });
});

function setup(): { readonly database: DatabaseConnection; readonly repository: DiscoveryRepository } {
  const database = createDatabase({ filename: ':memory:' });
  databases.push(database);
  migrateDatabase({ database });
  return { database, repository: createDiscoveryRepository({ database }) };
}

function seedRecommendation(database: DatabaseConnection, index: number): void {
  database.prepare({ sql: `
    INSERT OR IGNORE INTO discovery_interests (
      interest_id, description, status, created_from, created_at, updated_at
    ) VALUES ('interest:agents', 'Agent runtime', 'active', 'manual', ?, ?)
  ` }).run([now, now]);
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'open_web', ?, 'article', ?, ?, 0, 'consumed', ?, ?)
  ` }).run([
    `candidate:${index}`,
    `identity:${index}`,
    `https://example.com/${index}`,
    `Recommendation ${index}`,
    `Summary ${index}`,
    now,
    '2026-09-27T08:00:00.000Z',
  ]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      id, candidate_id, content_identity, local_date, position, recommendation_reason,
      selection_basis_json, published_at
    ) VALUES (?, ?, ?, '2026-08-27', ?, ?, ?, ?)
  ` }).run([
    `recommendation:${index}`,
    `candidate:${index}`,
    `identity:${index}`,
    index,
    `Reason ${index}`,
    JSON.stringify({
      primaryInterestId: 'interest:agents',
      matchedInterestIds: ['interest:agents'],
      interestRevisions: [{ interestId: 'interest:agents', revision: 1 }],
      preferenceRevisions: [],
    }),
    now,
  ]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendation_contents (
      id, recommendation_id, source_id, source_name, canonical_url, content_type,
      title, description, content_summary, content_truncated
    ) VALUES (?, ?, 'open_web', 'example.com', ?, 'article', ?, ?, ?, 0)
  ` }).run([
    `recommendation-content:${index}`,
    `recommendation:${index}`,
    `https://example.com/${index}`,
    `Recommendation ${index}`,
    `Description ${index}`,
    `Summary ${index}`,
  ]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendation_states (
      id, recommendation_id, reaction_revision, learned_reaction_revision, updated_at
    ) VALUES (?, ?, 0, 0, ?)
  ` }).run([`recommendation-state:${index}`, `recommendation:${index}`, now]);
}

function setReaction(
  database: DatabaseConnection,
  index: number,
  reaction: 'liked' | 'disliked' | null,
  changedAt = now,
): void {
  database.prepare({ sql: `
    UPDATE discovery_recommendation_states
    SET reaction = ?, reaction_revision = reaction_revision + 1,
        reaction_changed_at = ?, updated_at = ?
    WHERE recommendation_id = ?
  ` }).run([reaction, changedAt, changedAt, `recommendation:${index}`]);
}
