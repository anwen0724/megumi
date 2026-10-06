/* Verifies a supply round reads its configuration from one Settings snapshot. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readSupplyConfig } from '@megumi/application/recommendation/supply/read-supply-config';
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
  it('reports a missing model reference instead of choosing another model', () => {
    const result = readSupplyConfig(snapshotWithDiscovery({}));

    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error('expected a rejected configuration');
    expect(result.code).toBe('MODEL_NOT_CONFIGURED');
  });

  it('reads the supply slice with its initial thresholds and budget', () => {
    const result = readSupplyConfig(
      snapshotWithDiscovery({ candidateSupplyModel: { providerId: 'openai', modelId: 'gpt-x' } }),
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected a supply configuration');
    expect(result.config.model).toEqual({ providerId: 'openai', modelId: 'gpt-x' });
    expect(result.config.daily).toEqual({
      minimumCount: 100,
      targetCount: 200,
      interestMinimumCount: 10,
      interestTargetCount: 30,
    });
    expect(result.config.longTerm).toEqual({
      minimumCount: 100,
      targetCount: 300,
      interestMinimumCount: 10,
      interestTargetCount: 40,
    });
    expect(result.config.freshnessDays).toBe(7);
    expect(result.config.maintenanceIntervalMinutes).toBe(60);
    expect(result.config.limits.maxEmbeddingCalls).toBe(0);
  });
});
