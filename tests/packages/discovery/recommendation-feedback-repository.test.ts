/* Verifies atomic Recommendation feedback state and immutable learning changes. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository, type DiscoveryRepository } from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';
const databases: DatabaseConnection[] = [];

describe('Recommendation feedback repository', () => {
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('atomically saves the current reaction and an immutable pending change', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 'recommendation:1');

    const view = repository.updateRecommendationState({
      recommendationId: 'recommendation:1',
      action: 'set_reaction',
      reaction: 'liked',
      feedbackId: 'feedback:1',
      feedbackChangeId: 'feedback-change:1',
      now,
    });

    expect(view.reaction).toBe('liked');
    expect(database.prepare<FeedbackRow>({
      sql: 'SELECT * FROM discovery_feedback_changes WHERE feedback_change_id = ?',
    }).get(['feedback-change:1'])).toMatchObject({
      feedback_id: 'feedback:1',
      recommendation_id: 'recommendation:1',
      previous_reaction: null,
      current_reaction: 'liked',
      feedback_revision: 1,
      status: 'pending',
      requires_correction: 0,
    });
    expect(database.prepare<RecommendationFeedbackRow>({
      sql: 'SELECT feedback_id, feedback_revision, learned_feedback_revision FROM discovery_recommendations WHERE recommendation_id = ?',
    }).get(['recommendation:1'])).toEqual({
      feedback_id: 'feedback:1',
      feedback_revision: 1,
      learned_feedback_revision: 0,
    });
  });

  it('coalesces pending changes by Recommendation without deleting their history', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 'recommendation:1');
    setReaction(repository, 'liked', 1);
    setReaction(repository, 'disliked', 2);
    setReaction(repository, null, 3);

    const changes = database.prepare<FeedbackStatusRow>({ sql: `
      SELECT feedback_change_id, status FROM discovery_feedback_changes ORDER BY feedback_revision
    ` }).all();

    expect(changes).toEqual([
      { feedback_change_id: 'feedback-change:1', status: 'superseded' },
      { feedback_change_id: 'feedback-change:2', status: 'superseded' },
      { feedback_change_id: 'feedback-change:3', status: 'ignored' },
    ]);
    expect(repository.readPreferenceLearningTrigger({ now })).toEqual({ status: 'idle' });
  });

  it('does not create learning changes for organization-only Recommendation actions', () => {
    const { database, repository } = setup();
    seedRecommendation(database, 'recommendation:1');

    repository.updateRecommendationState({
      recommendationId: 'recommendation:1', action: 'set_favorite', favorite: true, now,
    });
    repository.updateRecommendationState({
      recommendationId: 'recommendation:1', action: 'set_watch_later', watchLater: true, now,
    });
    repository.updateRecommendationState({
      recommendationId: 'recommendation:1', action: 'opened', now,
    });

    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_feedback_changes',
    }).get()?.count).toBe(0);
  });
});

function setup(): { readonly database: DatabaseConnection; readonly repository: DiscoveryRepository } {
  const database = createDatabase({ filename: ':memory:' });
  databases.push(database);
  migrateDatabase({ database });
  return { database, repository: createDiscoveryRepository({ database }) };
}

function setReaction(
  repository: DiscoveryRepository,
  reaction: 'liked' | 'disliked' | null,
  revision: number,
): void {
  repository.updateRecommendationState({
    recommendationId: 'recommendation:1',
    action: 'set_reaction',
    reaction,
    feedbackId: 'feedback:1',
    feedbackChangeId: `feedback-change:${revision}`,
    now: new Date(Date.parse(now) + revision).toISOString(),
  });
}

function seedRecommendation(database: DatabaseConnection, recommendationId: string): void {
  database.prepare({ sql: `
    INSERT OR IGNORE INTO discovery_interests (
      interest_id, description, status, created_from, created_at, updated_at
    ) VALUES ('interest:agents', 'Agent runtime', 'active', 'manual', ?, ?)
  ` }).run([now, now]);
  database.prepare({ sql: `
    INSERT OR IGNORE INTO discovery_batches (
      batch_id, local_date, timezone, status, execution_id, requested_count, target_count,
      attempt_count, automatic_retry_count, result_count, created_at, updated_at, started_at, published_at
    ) VALUES ('batch:1', '2026-08-27', 'UTC', 'published', 'execution:daily', 3, 3, 1, 0, 1, ?, ?, ?, ?)
  ` }).run([now, now, now, now]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, description, recommendation_reason, published_at,
      matched_interest_ids_json, interest_revisions_json, preference_revisions_json,
      content_evidence_json
    ) VALUES (?, 'batch:1', ?, 0, 'open_web', 'example.com', ?, ?, 'article', ?, ?, ?,
      '["interest:agents"]', '{"interest:agents":1}', '{}',
      '{"completeness":"partial","text":"Fixed content evidence"}')
  ` }).run([
    recommendationId,
    `identity:${recommendationId}`,
    `https://example.com/${recommendationId}`,
    recommendationId,
    `${recommendationId} description`,
    `${recommendationId} reason`,
    now,
  ]);
}

interface FeedbackRow {
  readonly feedback_id: string;
  readonly recommendation_id: string;
  readonly previous_reaction: string | null;
  readonly current_reaction: string | null;
  readonly feedback_revision: number;
  readonly status: string;
  readonly requires_correction: number;
}

interface RecommendationFeedbackRow {
  readonly feedback_id: string | null;
  readonly feedback_revision: number;
  readonly learned_feedback_revision: number;
}

interface FeedbackStatusRow {
  readonly feedback_change_id: string;
  readonly status: string;
}
