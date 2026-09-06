/*
 * Maintains preference input versions inside Discovery's feedback and interest transactions.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@megumi/database';
import { RecommendationSelectionBasisSchema } from '../recommendation/recommendation';
import { PreferenceGuardSchema, type PreferenceGuard } from '../preferences/preference';

/** Captures all active interests and their existing scope guards from authoritative rows. */
export function readPreferenceGuard(database: DatabaseConnection): PreferenceGuard {
  return PreferenceGuardSchema.parse({
    interests: database.prepare<{ id: string; revision: number }>({ sql: "SELECT id,revision FROM discovery_interests WHERE status='active' ORDER BY id" }).all(),
    scopes: database.prepare<{ id: string; policy_revision: number }>({ sql: "SELECT s.id,s.policy_revision FROM discovery_preference_sets s LEFT JOIN discovery_interests i ON i.id=s.interest_id WHERE s.scope='exploration' OR i.status='active' ORDER BY s.id" }).all().map((row) => ({ id: row.id, policyRevision: row.policy_revision })),
  });
}

/** Must be invoked within the transaction that publishes and consumes candidates. */
export function validatePreferenceGuard(database: DatabaseConnection, expected: PreferenceGuard): boolean {
  const actual = readPreferenceGuard(database);
  const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  // A newly created zero-policy scope contains no correction and must not interrupt selection.
  const changedScopes = (scopes: PreferenceGuard['scopes']) => scopes.filter((scope) => scope.policyRevision > 0).sort(byId);
  return JSON.stringify(actual.interests) === JSON.stringify([...expected.interests].sort(byId))
    && JSON.stringify(changedScopes(actual.scopes)) === JSON.stringify(changedScopes(expected.scopes));
}

/** Creates the durable scope boundary even when no preference has been inferred. */
export function ensurePreferenceSet(database: DatabaseConnection, interestId: string | undefined, now: string): string {
  const existing = database.prepare<{ id: string }>({ sql: interestId
    ? 'SELECT id FROM discovery_preference_sets WHERE interest_id=?'
    : "SELECT id FROM discovery_preference_sets WHERE scope='exploration'",
  }).get(interestId ? [interestId] : []);
  if (existing) return existing.id;
  const id = randomUUID();
  database.prepare({ sql: 'INSERT INTO discovery_preference_sets (id,scope,interest_id,created_at,updated_at) VALUES (?,?,?,?,?)' })
    .run([id, interestId ? 'interest' : 'exploration', interestId ?? null, now, now]);
  return id;
}

/** Advances the learning watermark and, for corrections, the publication guard. */
export function changePreferenceInputs(database: DatabaseConnection, setId: string, now: string, correction: boolean, invalidateAll = false): void {
  database.prepare({ sql: 'UPDATE discovery_preference_sets SET revision=revision+1,policy_revision=policy_revision+?,updated_at=? WHERE id=?' })
    .run([Number(correction), now, setId]);
  if (invalidateAll) database.prepare({ sql: "UPDATE discovery_preferences SET status='needs_review',revision=revision+1,updated_at=? WHERE preference_set_id=? AND origin='learned' AND status='active'" }).run([now, setId]);
}

/** Records a feedback change without scheduling model work or relying on event delivery. */
export function recordPreferenceFeedbackChange(database: DatabaseConnection, recommendationId: string, previousRevision: number, now: string): void {
  const row = database.prepare<{ selection_basis_json: string }>({ sql: 'SELECT selection_basis_json FROM discovery_recommendations WHERE id=?' }).get([recommendationId]);
  if (!row) throw new Error('Feedback has no Recommendation.');
  const basis = RecommendationSelectionBasisSchema.parse(JSON.parse(row.selection_basis_json));
  const scopes = new Set(basis.matchedInterestIds.map((id) => ensurePreferenceSet(database, id, now)));
  if (!basis.matchedInterestIds.length) scopes.add(ensurePreferenceSet(database, undefined, now));
  for (const entry of database.prepare<{ preference_set_id: string }>({ sql: 'SELECT DISTINCT p.preference_set_id FROM discovery_preferences p JOIN discovery_preference_evidence e ON e.preference_id=p.id WHERE e.recommendation_id=?' }).all([recommendationId])) scopes.add(entry.preference_set_id);
  database.prepare({ sql: `UPDATE discovery_preferences SET status='needs_review',revision=revision+1,updated_at=?
    WHERE origin='learned' AND status='active' AND id IN (SELECT preference_id FROM discovery_preference_evidence WHERE recommendation_id=?)` }).run([now, recommendationId]);
  for (const id of scopes) changePreferenceInputs(database, id, now, previousRevision > 0);
}
