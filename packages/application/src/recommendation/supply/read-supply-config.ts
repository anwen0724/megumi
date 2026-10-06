/*
 * Reads one round's Candidate Supply execution configuration from a Settings
 * snapshot. The snapshot already passed schema validation, so this module only
 * selects the supply fields and never substitutes another default.
 *
 * The model reference is read separately: a missing or unusable model must not
 * make already sufficient local candidates look unavailable.
 */
import type {
  CandidatePoolThresholds,
  CandidateSupplyLimits,
} from '../../settings/definitions/discovery';
import type { SettingsSnapshot } from '../../settings/settings-contracts';

/** Provider and model a round must use; the AI runtime resolves it later. */
export interface SupplyModelReference {
  readonly providerId: string;
  readonly modelId: string;
}

/** The immutable configuration one maintenance round runs with. */
export interface SupplyExecutionConfig {
  readonly daily: CandidatePoolThresholds;
  readonly longTerm: CandidatePoolThresholds;
  readonly freshnessDays: number;
  readonly maintenanceIntervalMinutes: number;
  readonly contentLanguages: readonly string[];
  readonly searchHistoryDays: number;
  readonly searchReuseIntervalMinutes: number;
  readonly limits: CandidateSupplyLimits;
}

/** Selects the supply slice of one Settings snapshot. */
export function readSupplyConfig(snapshot: SettingsSnapshot): SupplyExecutionConfig {
  const { candidateSupply } = snapshot.config.discovery;
  return {
    daily: candidateSupply.daily,
    longTerm: candidateSupply.longTerm,
    freshnessDays: candidateSupply.freshnessDays,
    maintenanceIntervalMinutes: candidateSupply.maintenanceIntervalMinutes,
    contentLanguages: candidateSupply.contentLanguages,
    searchHistoryDays: candidateSupply.searchHistoryDays,
    searchReuseIntervalMinutes: candidateSupply.searchReuseIntervalMinutes,
    limits: candidateSupply.limits,
  };
}

/**
 * Reads the model the user selected for supply. `undefined` means the user has
 * not selected one; resolving a stale reference is the AI runtime's job.
 */
export function readSupplyModel(snapshot: SettingsSnapshot): SupplyModelReference | undefined {
  return snapshot.config.discovery.candidateSupplyModel;
}
