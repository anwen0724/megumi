/*
 * Verifies the Interest/Preference upgrade preserves identities and existing feedback.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import { createDiscoveryRepository } from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';

describe('Interest and Preference entity upgrade', () => {
  it('preserves business identities and historical recommendation references from version 23', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-preference-upgrade-'));
    const database = createDatabase({ filename: path.join(root, 'test.sqlite') });
    try {
      const migrations = path.join(process.cwd(), 'packages/agent/database/migrations');
      const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'));
      const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 23);
      const previous = path.join(root, 'migrations');
      fs.mkdirSync(path.join(previous, 'meta'), { recursive: true });
      for (const entry of entries) fs.copyFileSync(path.join(migrations, entry.tag + '.sql'), path.join(previous, entry.tag + '.sql'));
      fs.writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      migrateDatabase({ database, migrationsFolder: previous });
      seedLegacyRecommendation(database, 1);
      database.prepare({ sql: "UPDATE discovery_recommendation_states SET reaction='disliked', reaction_revision=2, learned_reaction='liked', learned_reaction_revision=1, reaction_changed_at=? WHERE recommendation_id='recommendation:1'" }).run([now]);
      database.prepare({ sql: "INSERT INTO discovery_preference_scopes VALUES ('interest:agents', 'interest', 'interest:agents', 4, ?)" }).run([now]);
      database.prepare({ sql: "INSERT INTO discovery_preference_directions VALUES ('preference:old', 'interest:agents', 'positive', 'topic', 'Agent engineering', ?)" }).run([now]);
      database.prepare({ sql: "INSERT INTO discovery_preference_direction_recommendations VALUES ('evidence:old', 'preference:old', 'recommendation:1')" }).run();
      database.prepare({ sql: "UPDATE discovery_recommendations SET selection_basis_json = json_set(selection_basis_json, '$.preferenceRevisions', json(?))" }).run([JSON.stringify([{ scopeKey: 'interest:agents', revision: 4 }])]);

      migrateDatabase({ database });
      const repository = createDiscoveryRepository({ database });
      const group = repository.listPreferenceSetDetails()[0];
      expect(group.preferenceSet).toMatchObject({ id: expect.any(String), interestId: 'interest:agents', revision: 4 });
      expect(group.preferenceSet.id).not.toBe('interest:agents');
      expect(group.preferences[0]).toMatchObject({
        preference: { id: 'preference:old', createdAt: now },
        evidence: [{ id: 'evidence:old', recommendationId: 'recommendation:1', reaction: 'liked', reactionRevision: 1 }],
      });
      expect(repository.findInterestById('interest:agents')?.id).toBe('interest:agents');
      expect(repository.findRecommendationById('recommendation:1')?.selectionBasis.preferenceRevisions).toEqual([
        { preferenceSetId: group.preferenceSet.id, revision: 4 },
      ]);
      expect(repository.getPreferenceLearningCompletion('recommendation:1')).toMatchObject({
        status: 'pending', currentReactionRevision: 2, learnedReactionRevision: 1,
      });
      expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences).toEqual([]);
      expect(database.prepare({ sql: 'PRAGMA foreign_key_check' }).all()).toEqual([]);
      expect(database.prepare({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name='discovery_preference_learning_batches'" }).get()).toBeUndefined();

      // Reapplying migrations is a no-op, including randomly assigned set identities.
      migrateDatabase({ database });
      expect(repository.listPreferenceSetDetails()[0].preferenceSet.id).toBe(group.preferenceSet.id);
    } finally {
      database.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces unique scope, evidence pair and nonnegative revision constraints', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      const add = (id: string) => database.prepare({ sql: "INSERT INTO discovery_preference_sets (id,scope,interest_id,revision,created_at,updated_at) VALUES (?, 'exploration', NULL, 0, ?, ?)" }).run([id, now, now]);
      add('set:1');
      expect(() => add('set:2')).toThrow();
      expect(() => database.prepare({ sql: "UPDATE discovery_preference_sets SET revision=-1" }).run()).toThrow();
      expect(() => database.prepare({ sql: "INSERT INTO discovery_preferences (id,preference_set_id,polarity,dimension,statement,created_at,updated_at) VALUES ('preference:1', 'missing', 'positive', 'topic', 'A preference', ?, ?)" }).run([now, now])).toThrow();
    } finally { database.close(); }
  });
});

function seedLegacyRecommendation(database: DatabaseConnection, index: number): void {
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
