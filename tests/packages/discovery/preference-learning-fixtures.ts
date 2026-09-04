/*
 * Seeds real Recommendation business facts for Preference repository and runtime tests.
 */
// @vitest-environment node
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery';

export const now = '2026-08-27T08:00:00.000Z';

export function createLearningFixture() {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return { database, repository: createDiscoveryRepository({ database }) };
}

export function seedRecommendation(database: DatabaseConnection, index: number): void {
  database.prepare({ sql: `
    INSERT OR IGNORE INTO discovery_interests (
      id, description, status, created_from, created_at, updated_at
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

export function setReaction(
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
