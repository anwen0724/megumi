/* Verifies learning thresholds, durable batches, and atomic Preference revisions. */
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

  it('triggers immediately at three pending Feedback identities', () => {
    const { database, repository } = setup();
    for (let index = 1; index <= 3; index += 1) {
      seedRecommendation(database, index);
      setReaction(repository, index, 'liked');
    }

    expect(repository.readPreferenceLearningTrigger({ now })).toEqual({
      status: 'ready',
      reason: 'threshold',
      pendingFeedbackCount: 3,
    });
  });

  it('schedules one or two Feedback identities for the oldest ten-minute deadline', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(repository, 1, 'liked');

    expect(repository.readPreferenceLearningTrigger({ now })).toEqual({
      status: 'scheduled',
      pendingFeedbackCount: 1,
      dueAt: '2026-08-27T08:10:00.000Z',
    });
    expect(repository.readPreferenceLearningTrigger({ now: '2026-08-27T08:10:00.000Z' })).toEqual({
      status: 'ready',
      reason: 'deadline',
      pendingFeedbackCount: 1,
    });
  });

  it('claims a fixed batch and atomically commits a complete Preference revision', () => {
    const { database, repository } = setup();
    for (let index = 1; index <= 3; index += 1) {
      seedRecommendation(database, index);
      setReaction(repository, index, 'liked');
    }
    const batch = repository.claimPreferenceLearningBatch({
      batchId: 'preference-batch:1',
      reason: 'threshold',
      now,
      limit: 20,
    });
    expect(batch?.status).toBe('running');
    const facts = repository.readPreferenceLearningFacts('preference-batch:1');
    expect(facts?.feedbackChanges).toHaveLength(3);
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
          supportingFeedbackIds: ['feedback:1', 'feedback:2', 'feedback:3'],
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
        supportingFeedbackIds: ['feedback:1', 'feedback:2', 'feedback:3'],
        updatedAt: now,
      }],
      updatedAt: now,
    }]);
    expect(repository.readPreferenceLearningTrigger({ now })).toEqual({ status: 'idle' });
  });

  it('rejects invalid evidence without partially advancing the batch', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(repository, 1, 'liked');
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
          supportingFeedbackIds: ['feedback:outside-batch'],
        }],
      }],
    });

    expect(result).toEqual({ status: 'rejected', reason: 'invalid_feedback_reference' });
    expect(repository.listPreferenceSnapshots()).toEqual([]);
    expect(database.prepare<{ status: string }>({
      sql: 'SELECT status FROM discovery_preference_learning_batches WHERE batch_id = ?',
    }).get(['preference-batch:1'])?.status).toBe('running');
  });

  it('makes a learned Feedback switch immediately ready for correction', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 1);
    setReaction(repository, 1, 'liked');
    repository.claimPreferenceLearningBatch({
      batchId: 'preference-batch:1', reason: 'deadline', now: '2026-08-27T08:10:00.000Z', limit: 20,
    });
    repository.commitPreferenceLearningBatch({
      batchId: 'preference-batch:1', committedAt: '2026-08-27T08:10:01.000Z',
      scopes: [{
        scopeKey: 'interest:interest:agents', baseRevision: 0,
        directions: [{
          directionId: 'preference-direction:1', polarity: 'positive', dimension: 'topic',
          statement: '关注 Agent Runtime。', supportingFeedbackIds: ['feedback:1'],
        }],
      }],
    });

    repository.updateRecommendationState({
      recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'disliked',
      feedbackId: 'feedback:1', feedbackChangeId: 'feedback-change:1:correction',
      now: '2026-08-27T08:11:00.000Z',
    });

    expect(repository.readPreferenceLearningTrigger({ now: '2026-08-27T08:11:00.000Z' })).toEqual({
      status: 'ready', reason: 'correction', pendingFeedbackCount: 1,
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
    INSERT OR IGNORE INTO discovery_batches (
      batch_id, local_date, timezone, status, execution_id, requested_count, target_count,
      attempt_count, automatic_retry_count, result_count, created_at, updated_at, started_at, published_at
    ) VALUES ('batch:1', '2026-08-27', 'UTC', 'published', 'execution:daily', 3, 3, 1, 0, 3, ?, ?, ?, ?)
  ` }).run([now, now, now, now]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, description, recommendation_reason, published_at,
      matched_interest_ids_json, interest_revisions_json, preference_revisions_json,
      content_evidence_json
    ) VALUES (?, 'batch:1', ?, ?, 'open_web', 'example.com', ?, ?, 'article', ?, ?, ?,
      '["interest:agents"]', '{"interest:agents":1}', '{}',
      '{"sourceId":"open_web","canonicalUrl":"https://example.com/evidence","title":"Fixed content evidence","description":"Durable Recommendation evidence.","completeness":"partial"}')
  ` }).run([
    `recommendation:${index}`,
    `identity:${index}`,
    index,
    `https://example.com/${index}`,
    `Recommendation ${index}`,
    `Description ${index}`,
    `Reason ${index}`,
    now,
  ]);
}

function setReaction(
  repository: DiscoveryRepository,
  index: number,
  reaction: 'liked' | 'disliked' | null,
): void {
  repository.updateRecommendationState({
    recommendationId: `recommendation:${index}`,
    action: 'set_reaction',
    reaction,
    feedbackId: `feedback:${index}`,
    feedbackChangeId: `feedback-change:${index}`,
    now,
  });
}
