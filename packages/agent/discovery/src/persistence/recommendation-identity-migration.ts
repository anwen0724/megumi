/*
 * Owns the one-way migration from legacy Recommendation identities to canonical identities.
 */
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import { canonicalContentIdentity } from '../daily-discovery/content-identity';

export interface RecommendationIdentityMigrationResult {
  readonly migrated: number;
  readonly duplicates: number;
}

/** Migrates every pending legacy identity in one database transaction. */
export function migrateRecommendationIdentities(
  database: DatabaseConnection,
): RecommendationIdentityMigrationResult {
  return database.transaction({
    operation: () => migrateRecommendationIdentitiesInTransaction(database),
  });
}

/** Rewrites pending identities while preserving one deterministic winner per canonical URL. */
function migrateRecommendationIdentitiesInTransaction(
  database: DatabaseConnection,
): RecommendationIdentityMigrationResult {
  const rows = database.prepare<RecommendationIdentityRow>({ sql: `
    SELECT recommendation_id, content_identity, canonical_url
    FROM discovery_recommendations
    ORDER BY published_at, position, recommendation_id
  ` }).all();
  const pendingIds = new Set(rows
    .filter((row) => (
      !row.content_identity.startsWith('content:v2:')
      && !row.content_identity.startsWith('content:legacy-duplicate:')
    ))
    .map((row) => row.recommendation_id));
  if (pendingIds.size === 0) return { migrated: 0, duplicates: 0 };

  const canonicalById = new Map(rows.map((row) => [
    row.recommendation_id,
    row.content_identity.startsWith('content:v2:')
      ? row.content_identity
      : canonicalContentIdentity({ canonicalUrl: row.canonical_url }),
  ]));
  for (const recommendationId of pendingIds) {
    database.prepare({ sql: `
      UPDATE discovery_recommendations SET content_identity = ? WHERE recommendation_id = ?
    ` }).run([`content:migration:${recommendationId}`, recommendationId]);
  }

  const winnerByCanonical = new Map<string, string>();
  let duplicates = 0;
  for (const row of rows) {
    if (row.content_identity.startsWith('content:legacy-duplicate:')) continue;
    const canonical = canonicalById.get(row.recommendation_id);
    if (!canonical) {
      throw new Error(`Recommendation identity was not prepared: ${row.recommendation_id}.`);
    }
    const winner = winnerByCanonical.get(canonical);
    if (!winner) winnerByCanonical.set(canonical, row.recommendation_id);
    if (!pendingIds.has(row.recommendation_id)) continue;
    const nextIdentity = winner
      ? `content:legacy-duplicate:${row.recommendation_id}`
      : canonical;
    if (winner) duplicates += 1;
    database.prepare({ sql: `
      UPDATE discovery_recommendations SET content_identity = ? WHERE recommendation_id = ?
    ` }).run([nextIdentity, row.recommendation_id]);
  }
  return { migrated: pendingIds.size, duplicates };
}

type RecommendationIdentityRow = DatabaseRow & {
  recommendation_id: string;
  content_identity: string;
  canonical_url: string;
};
