/*
 * Reads one round's Candidate Supply execution configuration from a Settings
 * snapshot. The snapshot already passed schema validation, so this module only
 * selects the supply fields and reports a missing model reference; it never
 * substitutes another model or another default.
 */
import type {
  CandidatePoolThresholds,
  CandidateSupplyLimits,
} from '../../settings/definitions/discovery';
import type { SettingsSnapshot } from '../../settings/settings-contracts';

/** Provider and model the round must use; the AI runtime resolves it later. */
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
  readonly model: SupplyModelReference;
}

export type ReadSupplyConfigResult =
  | { status: 'ok'; config: SupplyExecutionConfig }
  | { status: 'rejected'; code: 'MODEL_NOT_CONFIGURED'; message: string };

/**
 * Reads the supply slice of one Settings snapshot. A missing model reference is
 * a configuration problem; a stale reference is reported when the AI runtime
 * resolves it, not by silently choosing a different model here.
 */
export function readSupplyConfig(snapshot: SettingsSnapshot): ReadSupplyConfigResult {
  const { candidateSupply, candidateSupplyModel } = snapshot.config.discovery;
  if (!candidateSupplyModel) {
    return {
      status: 'rejected',
      code: 'MODEL_NOT_CONFIGURED',
      message: 'Candidate supply model is not selected.',
    };
  }
  return {
    status: 'ok',
    config: {
      daily: candidateSupply.daily,
      longTerm: candidateSupply.longTerm,
      freshnessDays: candidateSupply.freshnessDays,
      maintenanceIntervalMinutes: candidateSupply.maintenanceIntervalMinutes,
      contentLanguages: candidateSupply.contentLanguages,
      searchHistoryDays: candidateSupply.searchHistoryDays,
      searchReuseIntervalMinutes: candidateSupply.searchReuseIntervalMinutes,
      limits: candidateSupply.limits,
      model: candidateSupplyModel,
    },
  };
}
