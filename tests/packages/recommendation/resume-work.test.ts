/* Verifies a round resumes work an earlier process left unfinished. */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import { createExecutionBudget } from '@megumi/application/recommendation/supply/execution-budget';
import {
  runMaintenance,
  type MaintenanceDependencies,
  type MaintenanceRunInput,
} from '@megumi/application/recommendation/supply/run-maintenance';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const MATERIAL = '这里包含正文片段以及别的内容。';

describe('resume after an interrupted process', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let models: ReturnType<typeof createModels>;
  let model: Model<Api>;
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1');
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
  });

  afterEach(() => database.close());

  it('processes a discovery that was saved but never normalized', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'pending', NOW - 60_000);
    faux.setResponses([
      fauxAssistantMessage(analysisJson()),
      fauxAssistantMessage('{"items":[]}'),
    ]);

    await runMaintenance(dependencies(), runInput());

    expect(countRows(database, 'contents')).toBe(1);
    expect(countRows(database, 'content_analysis')).toBe(1);
    expect(countRows(database, 'recommendation_candidates')).toBe(1);
    expect(discoveryStatus(database, 'r1')).toBe('normalized');
  });

  it('leaves a failed discovery alone until its retry time is due', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'failed', NOW + 60_000);
    faux.setResponses([fauxAssistantMessage('{"items":[]}')]);

    await runMaintenance(dependencies(), runInput());

    expect(countRows(database, 'contents')).toBe(0);
    expect(discoveryStatus(database, 'r1')).toBe('failed');
  });

  it('retries a due discovery after its retry time passed', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'failed', NOW - 1_000);
    faux.setResponses([
      fauxAssistantMessage(analysisJson()),
      fauxAssistantMessage('{"items":[]}'),
    ]);

    await runMaintenance(dependencies(), runInput());

    expect(countRows(database, 'contents')).toBe(1);
  });

  function dependencies(): MaintenanceDependencies {
    const management = createInterestManagement({
      storage: createInterestStorage(database),
      newInterestId: () => `i${++sequence}`,
      now: () => NOW,
    });
    return {
      config: { ...CandidateSupplyConfigurationSchema.parse({}), model: { providerId: 'faux', modelId: 'faux-supply' } },
      database,
      model,
      source: stubSource(),
      client: models,
      interests: management,
      contents: createContentStorage(database),
      candidates: createCandidateStorage(database),
      search: createSearchStorage(database),
      usage: { readUsageSnapshot: async () => ({ revision: 'rev-1', excludedContentIds: [] }) },
      retention: { findRetainedContentIds: async () => [] },
      newId: (prefix) => `${prefix}-${++sequence}`,
      now: () => NOW,
    };
  }

  function runInput(): MaintenanceRunInput {
    return {
      trigger: 'startup',
      budget: createExecutionBudget({
        limits: CandidateSupplyConfigurationSchema.parse({}).limits,
        startedAt: NOW,
        now: () => NOW,
      }),
      signal: new AbortController().signal,
      deliver: async () => undefined,
    };
  }
});

function stubSource(): SourceConnector {
  return {
    id: 'zhihu',
    async search() {
      return { status: 'success', items: [] };
    },
    async fetch() {
      return {
        status: 'failed',
        failure: { code: 'material_unavailable', message: 'unsupported', retryable: false },
      };
    },
  };
}

function analysisJson(): string {
  return JSON.stringify({
    summary: '摘要',
    keyPoints: [{ text: '要点', evidence: '正文片段' }],
    topics: ['主题'],
    entities: ['实体'],
    contentType: 'article',
    qualityScore: 0.6,
    spamScore: 0.1,
    longTermValue: 'learning',
    matches: [{ interestId: 'i1', relation: 'direct', basis: '相关' }],
  });
}

function seedInterest(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, `interest ${id}`]);
}

function insertDiscovery(
  database: DatabaseConnection,
  id: string,
  url: string,
  status: string,
  retryAt: number,
): void {
  database
    .prepare({
      sql: `INSERT INTO search_results
              (id, source, url, description, status, attempts, retry_at, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, ?, ?, 0, ?, 0, 0)`,
    })
    .run([id, url, MATERIAL, status, retryAt]);
}

function discoveryStatus(database: DatabaseConnection, id: string): string | undefined {
  return database
    .prepare<{ status: string }>({ sql: 'SELECT status FROM search_results WHERE id = ?' })
    .get([id])?.status;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
