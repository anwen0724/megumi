/*
 * Verifies what an unsatisfied preparation request is told. A waiting caller
 * must learn why the round ended and which problems it reported; reporting a
 * budget that was never spent, or no problem at all, hides the real gap.
 */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import { createCandidateSupply } from '@megumi/application/recommendation/supply/create-supply';
import type { SupplyExecutionConfig } from '@megumi/application/recommendation/supply/read-supply-config';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;

const unusedSource: SourceConnector = {
  id: 'zhihu',
  async search() {
    return { status: 'success', items: [] };
  },
  async fetch() {
    return {
      status: 'failed',
      failure: { code: 'material_unavailable', message: 'not used', retryable: false },
    };
  },
};

describe('candidate supply reporting', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let model: Model<Api>;
  let client: ReturnType<typeof createModels>;
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    client = createModels();
    client.setProvider(faux.provider);
    const resolved = client.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
    void createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => `seed-${++sequence}`,
      now: () => NOW,
    }).createInterest({ text: 'Rust 异步运行时' });
  });

  afterEach(() => database.close());

  it('reports the reason the round actually ended, not an unspent budget', async () => {
    faux.setResponses([fauxAssistantMessage(JSON.stringify({ items: [] }))]);
    const supply = compose();

    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [] },
    });

    expect(result.status).toBe('insufficient');
    if (result.status !== 'insufficient') throw new Error('expected an insufficient result');
    expect(result.stopReason).toBe('sources_exhausted');
    expect(result.issues).toEqual([]);
  });

  it('reports a plan the program had to refuse instead of ending silently', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        JSON.stringify({
          items: [
            {
              interestId: 'invented-by-the-model',
              pools: ['daily'],
              source: 'zhihu',
              priority: 1,
              limit: 5,
            },
          ],
        }),
      ),
    ]);
    const supply = compose();

    const result = await supply.prepareCandidates({
      requirement: { pool: 'daily', minimumCount: 1, coverage: [] },
    });

    expect(result.status).toBe('insufficient');
    if (result.status !== 'insufficient') throw new Error('expected an insufficient result');
    expect(result.issues).toContainEqual({
      stage: 'search',
      code: 'plan_items_invalid',
      message: expect.stringContaining('unknown interest'),
    });
    expect(result.stopReason).toBe('sources_exhausted');
  });

  /** Composes supply over the real Database with the faux planning model. */
  function compose() {
    const interests = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => `i${++sequence}`,
      now: () => NOW,
    });
    const contents = createContentStorage(database);
    const candidates = createCandidateStorage(database);
    const usage = {
      async readUsageSnapshot() {
        return { revision: 'rev-1', excludedContentIds: [] };
      },
    };
    const configuration = CandidateSupplyConfigurationSchema.parse({});
    const config: SupplyExecutionConfig = {
      daily: configuration.daily,
      longTerm: configuration.longTerm,
      freshnessDays: configuration.freshnessDays,
      maintenanceIntervalMinutes: configuration.maintenanceIntervalMinutes,
      contentLanguages: configuration.contentLanguages,
      searchHistoryDays: configuration.searchHistoryDays,
      searchReuseIntervalMinutes: configuration.searchReuseIntervalMinutes,
      limits: configuration.limits,
    };

    return createCandidateSupply({
      local: { database, contents, candidates, usage, interests, now: () => NOW },
      readConfig: async () => ({ status: 'ok', config }),
      openRound: async () => ({
        status: 'ok',
        model,
        dependencies: {
          config,
          database,
          model,
          source: unusedSource,
          client,
          interests,
          contents,
          candidates,
          search: createSearchStorage(database),
          usage,
          retention: { findRetainedContentIds: async () => [] },
          newId: (prefix: string) => `${prefix}-${++sequence}`,
          now: () => NOW,
        },
      }),
      newId: (prefix) => `${prefix}-${++sequence}`,
    });
  }
});
