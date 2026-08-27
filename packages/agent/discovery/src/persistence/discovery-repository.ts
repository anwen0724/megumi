/*
 * Composes Discovery persistence owners into the stable package-level repository contract.
 */
import type { DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyRepository,
} from './candidate-supply-repository';
import type { CandidateSupplyRepository } from '../candidate-supply/candidate-supply';
import {
  createDailyRecommendationRepository,
  type DailyRecommendationRepository,
} from './daily-recommendation-repository';
import {
  createInterestRepository,
  type InterestRepository,
} from './interest-repository';
import {
  createRecommendationRepository,
  type RecommendationRepositoryOperations,
} from './recommendation-repository';
import {
  migrateRecommendationIdentities,
  type RecommendationIdentityMigrationResult,
} from './recommendation-identity-migration';

export type {
  ApplyInterestExtraction,
  ValidatedInterestCommand,
} from './interest-repository';
export type { RecommendationSelectionSignal } from './recommendation-repository';

export interface DiscoveryRepository
  extends InterestRepository, DailyRecommendationRepository, RecommendationRepositoryOperations,
    CandidateSupplyRepository {
  /** Migrates legacy Recommendation identities before normal Discovery work begins. */
  migrateRecommendationIdentities(): RecommendationIdentityMigrationResult;
}

/** Creates the stable Discovery repository from its focused persistence owners. */
export function createDiscoveryRepository(options: {
  readonly database: DatabaseConnection;
}): DiscoveryRepository {
  const interests = createInterestRepository(options.database);
  const candidateSupply = createCandidateSupplyRepository(options.database);
  const recommendations = createRecommendationRepository(options.database);
  const dailyRecommendation = createDailyRecommendationRepository(options.database);

  return {
    ...interests,
    ...dailyRecommendation,
    ...recommendations.operations,
    ...candidateSupply,
    migrateRecommendationIdentities: () => migrateRecommendationIdentities(options.database),
  };
}
