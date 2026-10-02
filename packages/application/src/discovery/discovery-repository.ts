/*
 * Composes Discovery persistence owners into the stable package-level repository contract.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../storage/index';
import {
  createCandidateSupplyRepository,
} from './candidates/candidate-supply-repository';
import type { CandidateSupplyRepository } from './candidates/candidate-supply';
import {
  createInterestRepository,
  type InterestRepository,
} from './interests/interest-repository';
import {
  createRecommendationRepository,
  type RecommendationRepository,
} from './recommendations/recommendation-repository';
import {
  createPreferenceLearningRepository,
  type PreferenceLearningRepository,
} from './preferences/preference-learning-repository';

export type {
  ApplyInterestExtraction,
  ValidatedInterestCommand,
} from './interests/interest-repository';
export interface DiscoveryRepository
  extends InterestRepository, RecommendationRepository, CandidateSupplyRepository, PreferenceLearningRepository {}

/** Creates the stable Discovery repository from its focused persistence owners. */
export function createDiscoveryRepository(options: {
  readonly database: DatabaseConnection;
  readonly clock?: { now(): string };
  readonly candidateIds?: {
    createCandidateId(): string;
    createInterestMatchId(): string;
  };
}): DiscoveryRepository {
  const interests = createInterestRepository(options.database);
  const candidateSupply = createCandidateSupplyRepository({
    database: options.database,
    clock: options.clock ?? { now: () => new Date().toISOString() },
    ids: options.candidateIds ?? {
      createCandidateId: () => `candidate:${randomUUID()}`,
      createInterestMatchId: () => `candidate-interest-match:${randomUUID()}`,
    },
  });
  const recommendations = createRecommendationRepository({
    database: options.database,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const preferences = createPreferenceLearningRepository(options.database);

  return {
    ...interests,
    ...recommendations,
    ...candidateSupply,
    ...preferences,
  };
}
