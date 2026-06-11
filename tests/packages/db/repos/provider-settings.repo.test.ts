// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDER_SETTINGS, type ProviderSettings } from '@megumi/shared/provider';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ProviderSettingsRepository } from '@megumi/db/repos/provider-settings.repo';

let db: Database.Database | null = null;

function createRepo(now = () => '2026-05-11T00:00:00.000Z'): ProviderSettingsRepository {
  db = new Database(':memory:');
  migrateDatabase(db);
  return new ProviderSettingsRepository(db, now);
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ProviderSettingsRepository', () => {
  it('initializes missing default providers', () => {
    const repo = createRepo();

    repo.initializeDefaults();

    expect(repo.list().map((settings) => settings.providerId)).toEqual([
      'deepseek',
      'openai',
      'anthropic',
    ]);
    expect(repo.get('deepseek')).toMatchObject({
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      enabled: true,
      baseUrl: 'https://api.deepseek.com',
      defaultModelId: 'deepseek-v4-flash',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
  });

  it('does not overwrite existing provider settings when initializing defaults', () => {
    const repo = createRepo();

    repo.upsert({
      ...DEFAULT_PROVIDER_SETTINGS.deepseek,
      displayName: 'Custom DeepSeek',
      enabled: false,
      baseUrl: 'https://example.test',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });

    repo.initializeDefaults();

    expect(repo.get('deepseek')).toMatchObject({
      providerId: 'deepseek',
      displayName: 'Custom DeepSeek',
      enabled: false,
      baseUrl: 'https://example.test',
      createdAt: '2026-05-10T00:00:00.000Z',
      updatedAt: '2026-05-10T00:00:00.000Z',
    });
  });

  it('upserts and maps secret references without plaintext keys', () => {
    const repo = createRepo();

    const settings: ProviderSettings = {
      ...DEFAULT_PROVIDER_SETTINGS.openai,
      secretRef: {
        id: 'secret:provider-api-key:openai',
        providerId: 'openai',
        scope: 'provider-api-key',
      },
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    };

    repo.upsert(settings);

    expect(repo.get('openai')).toEqual(settings);
    expect(JSON.stringify(repo.list())).not.toContain('sk-');
  });

  it('updates only provided provider fields', () => {
    const repo = createRepo(() => '2026-05-11T01:02:03.000Z');

    repo.initializeDefaults();
    const updated = repo.updateProvider('deepseek', {
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });

    expect(updated).toMatchObject({
      providerId: 'deepseek',
      enabled: false,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
      updatedAt: '2026-05-11T01:02:03.000Z',
    });
    expect(updated.createdAt).toBe('2026-05-11T01:02:03.000Z');
  });

  it('returns undefined for unknown provider rows', () => {
    const repo = createRepo();

    expect(repo.get('deepseek')).toBeUndefined();
  });
});

