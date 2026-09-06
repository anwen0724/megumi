/*
 * Installs an empty Discovery database and captures its durable business facts.
 * This maintenance boundary never executes supply, publication, or learning.
 */
import { z } from 'zod';
import type { DatabaseConnection, DatabaseValue } from '@megumi/database';
import { CandidateSchema, CandidateInterestMatchSchema } from '../candidate-supply/candidate-supply';
import { InterestSchema, InterestEvidenceSchema, InterestSessionSettingSchema } from '../interests/interest';
import { RecommendationDecisionSchema, RecommendationContentSchema, RecommendationStateSchema } from '../recommendation/recommendation';
import { PreferenceSetSchema, PreferenceSchema, PreferenceEvidenceSchema } from '../preferences/preference';

export const DiscoveryStateSchema = z.object({
  interests: z.array(InterestSchema),
  interestEvidence: z.array(InterestEvidenceSchema),
  interestSessionSettings: z.array(InterestSessionSettingSchema),
  candidates: z.array(CandidateSchema),
  candidateInterestMatches: z.array(CandidateInterestMatchSchema),
  recommendations: z.array(RecommendationDecisionSchema),
  recommendationContents: z.array(RecommendationContentSchema),
  recommendationStates: z.array(RecommendationStateSchema),
  preferenceSets: z.array(PreferenceSetSchema),
  preferences: z.array(PreferenceSchema),
  preferenceEvidence: z.array(PreferenceEvidenceSchema),
}).strict();
export type DiscoveryState = z.infer<typeof DiscoveryStateSchema>;

// Only these Owner-owned tables may be addressed. Identifiers never come from callers.
const tables = {
  interests: 'discovery_interests',
  interestEvidence: 'discovery_interest_evidence',
  interestSessionSettings: 'discovery_interest_session_settings',
  candidates: 'discovery_candidates',
  candidateInterestMatches: 'discovery_candidate_interest_matches',
  recommendations: 'discovery_recommendations',
  recommendationContents: 'discovery_recommendation_contents',
  recommendationStates: 'discovery_recommendation_states',
  preferenceSets: 'discovery_preference_sets',
  preferences: 'discovery_preferences',
  preferenceEvidence: 'discovery_preference_evidence',
} as const satisfies Record<keyof DiscoveryState, string>;

/** Reads persisted facts without expiring Candidates or otherwise changing state. */
export function getDiscoveryState(database: DatabaseConnection): DiscoveryState {
  return database.transaction({ operation: () => DiscoveryStateSchema.parse(Object.fromEntries(
    Object.entries(tables).map(([key, table]) => [key, database.prepare({ sql: `SELECT * FROM ${table} ORDER BY id` }).all().map((row) =>
      Object.fromEntries(Object.entries(row).filter(([, value]) => value !== null).map(([column, value]) => {
        if (column === 'selection_basis_json') return ['selectionBasis', JSON.parse(String(value))];
        if (column === 'content_truncated') return ['contentTruncated', value === 1];
        return [column.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase()), value];
      })),
    )]),
  )) });
}

/** Validates and atomically installs existing facts; rejects a nonempty target. */
export function initializeDiscoveryState(database: DatabaseConnection, input: DiscoveryState): DiscoveryState {
  const state = DiscoveryStateSchema.parse(input);
  validateReferences(state);
  return database.transaction({ operation: () => {
    for (const table of Object.values(tables)) {
      if (database.prepare({ sql: `SELECT id FROM ${table} LIMIT 1` }).get()) {
        throw new Error('Discovery state initialization requires an empty Discovery database.');
      }
    }
    for (const key of Object.keys(tables) as (keyof DiscoveryState)[]) {
      for (const entity of state[key]) {
        const entries = Object.entries(entity).filter(([, value]) => value !== undefined);
        const columns = entries.map(([field]) => field === 'selectionBasis' ? 'selection_basis_json' : field.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`));
        const values: DatabaseValue[] = entries.map(([field, value]) => {
          if (field === 'selectionBasis') return JSON.stringify(value);
          if (typeof value === 'boolean') return Number(value);
          if (typeof value === 'string' || typeof value === 'number') return value;
          throw new Error(`Unsupported Discovery state field: ${field}.`);
        });
        database.prepare({ sql: `INSERT INTO ${tables[key]} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})` }).run(values);
      }
    }
    return getDiscoveryState(database);
  } });
}

function validateReferences(state: DiscoveryState): void {
  const requireReference = (exists: boolean, message: string): void => {
    if (!exists) throw new Error(`Invalid Discovery initial state: ${message}.`);
  };
  for (const candidate of state.candidates) {
    requireReference(Date.parse(candidate.expiresAt) > Date.parse(candidate.createdAt), `Candidate ${candidate.id} expires before creation`);
    requireReference(state.candidateInterestMatches.some((match) => match.candidateId === candidate.id), `Candidate ${candidate.id} has no Interest match`);
  }
  for (const recommendation of state.recommendations) {
    const candidate = state.candidates.find(({ id }) => id === recommendation.candidateId);
    requireReference(candidate?.status === 'consumed' && candidate.contentIdentity === recommendation.contentIdentity, `Recommendation ${recommendation.id} has no consumed Candidate`);
    requireReference(state.recommendationContents.filter(({ recommendationId }) => recommendationId === recommendation.id).length === 1, `Recommendation ${recommendation.id} requires one content snapshot`);
    requireReference(state.recommendationStates.filter(({ recommendationId }) => recommendationId === recommendation.id).length === 1, `Recommendation ${recommendation.id} requires one state`);
    for (const interestId of recommendation.selectionBasis.matchedInterestIds) {
      requireReference(state.interests.some(({ id }) => id === interestId), `Recommendation ${recommendation.id} references missing Interest ${interestId}`);
    }
  }
  for (const evidence of state.preferenceEvidence) {
    const preference = state.preferences.find(({ id }) => id === evidence.preferenceId);
    const set = state.preferenceSets.find(({ id }) => id === preference?.preferenceSetId);
    const recommendation = state.recommendations.find(({ id }) => id === evidence.recommendationId);
    requireReference(!!set && !!recommendation && (set.scope === 'exploration'
      || recommendation.selectionBasis.matchedInterestIds.includes(set.interestId!)), `Preference evidence ${evidence.id} contradicts its Interest scope`);
    const reaction = state.recommendationStates.find(({ recommendationId }) => recommendationId === evidence.recommendationId);
    requireReference(!!reaction && evidence.reactionRevision <= reaction.reactionRevision, `Preference evidence ${evidence.id} references a future reaction revision`);
    if (reaction && evidence.reactionRevision === reaction.reactionRevision) {
      requireReference(evidence.reaction === reaction.reaction, `Preference evidence ${evidence.id} contradicts the current reaction`);
    }
  }
}
