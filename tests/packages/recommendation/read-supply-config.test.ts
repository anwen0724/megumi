/*
 * Verifies a supply round reads its configuration, and the model reference
 * separately, from one Settings snapshot. A missing model must not make the
 * configuration itself unreadable.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  readSupplyConfig,
  readSupplyModel,
} from '@megumi/application/recommendation/supply/read-supply-config';
import { ConfigurationSchema } from '@megumi/application/settings/index';
import type { SettingsSnapshot } from '@megumi/application/settings/index';

function snapshotWithDiscovery(discovery: Record<string, unknown>): SettingsSnapshot {
  return {
    config: ConfigurationSchema.parse({ discovery }),
    sources: [],
    revision: 'revision-1',
    diagnostics: [],
  };
}

describe('read supply config', () => {
  it('reads the configuration without requiring a model reference', () => {
    const snapshot = snapshotWithDiscovery({});

    expect(readSupplyModel(snapshot)).toBeUndefined();
    expect(readSupplyConfig(snapshot).freshnessDays).toBe(7);
  });

  it('reads the supply slice with its initial thresholds and budget', () => {
    const snapshot = snapshotWithDiscovery({
      candidateSupplyModel: { providerId: 'openai', modelId: 'gpt-x' },
    });
    const config = readSupplyConfig(snapshot);

    expect(readSupplyModel(snapshot)).toEqual({ providerId: 'openai', modelId: 'gpt-x' });
    expect(config.daily).toEqual({
      minimumCount: 100,
      targetCount: 200,
      interestMinimumCount: 10,
      interestTargetCount: 30,
    });
    expect(config.longTerm).toEqual({
      minimumCount: 100,
      targetCount: 300,
      interestMinimumCount: 10,
      interestTargetCount: 40,
    });
    expect(config.freshnessDays).toBe(7);
    expect(config.maintenanceIntervalMinutes).toBe(60);
    expect(config.contentLanguages).toEqual([]);
    expect(config.limits.maxEmbeddingCalls).toBe(0);
    expect(config.limits.maxResultsPerSearch).toBe(10);
  });
});
