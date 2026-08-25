/*
 * Composes Discovery persistence owners into the stable package-level repository contract.
 */
import type { DatabaseConnection } from '@megumi/database';
import {
  createDailyBatchRepository,
  type DailyBatchRepository,
} from './daily-batch-repository';
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
  ClaimDailyBatch,
  ClaimDailyBatchResult,
  FailDailyAttemptResult,
  PublishDailyBatch,
  PublishDailyBatchResult,
} from './daily-batch-repository';
export type {
  ApplyInterestExtraction,
  ValidatedInterestCommand,
} from './interest-repository';
export type { RecommendationSelectionSignal } from './recommendation-repository';

export interface DiscoveryRepository
  extends InterestRepository, DailyBatchRepository, RecommendationRepositoryOperations {
  /** Migrates legacy Recommendation identities before normal Discovery work begins. */
  migrateRecommendationIdentities(): RecommendationIdentityMigrationResult;
}

/** Creates the stable Discovery repository from its focused persistence owners. */
export function createDiscoveryRepository(options: {
  readonly database: DatabaseConnection;
}): DiscoveryRepository {
  const interests = createInterestRepository(options.database);
  const recommendations = createRecommendationRepository(options.database);
  const batches = createDailyBatchRepository(options.database, recommendations.publicationWriter);

  return {
    ...interests,
    ...batches,
    ...recommendations.operations,
    migrateRecommendationIdentities: () => migrateRecommendationIdentities(options.database),
  };
}
