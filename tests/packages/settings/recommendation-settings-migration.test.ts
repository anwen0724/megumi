/* Verifies explicit legacy settings conversion without touching credentials. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateRecommendationSettings } from '@megumi/application/settings/recommendation-settings-migration';
import { RecommendationConfigurationSchema } from '@megumi/application/settings/definitions/recommendation';
import { afterEach, expect, it, vi } from 'vitest';
let directory: string;
afterEach(() => {
  vi.restoreAllMocks();
  if (directory)
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
});

it('removes retired legacy sources without enabling new services and keeps the migrated file loadable', () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-settings-'));
  const file = path.join(directory, 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      general: { locale: 'zh-CN' },
      discovery: {
        candidateSupplyConfirmed: true,
        enabledSources: ['bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu'],
        candidateSupplyModel: {
          providerId: 'deepseek',
          modelId: 'deepseek-flash',
        },
      },
    }),
  );

  const result = migrateRecommendationSettings(file);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

  expect(saved).toMatchObject({
    general: { locale: 'zh-CN' },
    recommendationMigrationVersion: 1,
    discovery: {
      enabled: true,
      enabledSources: ['bilibili', 'xiaohongshu', 'zhihu'],
      candidateSupplyModel: {
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
      },
    },
  });
  expect(result.removedPaths).toContain('discovery.enabledSources[1]');
  expect(result.removedPaths).toContain('discovery.enabledSources[3]');
  expect(migrateRecommendationSettings(file).status).toBe('unchanged');
});

it('converts only explicit recommendation fields and preserves unrelated settings and credentials', () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-settings-'));
  const globalSettingsPath = path.join(directory, 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  fs.writeFileSync(
    globalSettingsPath,
    JSON.stringify({
      general: { locale: 'en' },
      discovery: {
        candidateSupplyConfirmed: true,
        candidateSupply: {
          freshnessDays: 10,
          longTerm: {
            interestMinimumCount: 3,
            interestTargetCount: 8,
          },
          limits: {
            maxSearchCalls: 1,
            maxConcurrentRequests: 4,
            maxScreeningCalls: 7,
          },
        },
      },
    }),
  );
  fs.writeFileSync(credentialsPath, '{"credentials":"untouched"}');
  migrateRecommendationSettings(globalSettingsPath);

  expect(JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'))).toMatchObject({
    general: { locale: 'en' },
    recommendationMigrationVersion: 1,
    discovery: {
      enabled: true,
      enabledSources: ['zhihu'],
      dailyFeed: { lookbackDays: 7 },
      candidateSupply: {
        interestMinimumCount: 3,
        interestTargetCount: 8,
      },
      limits: {
        maxSearchCalls: 2,
        maxConcurrentSourceRequests: 4,
        maxConcurrentModelRequests: 4,
        maxJudgmentCalls: 7,
      },
    },
  });
  expect(fs.readFileSync(credentialsPath, 'utf8')).toBe('{"credentials":"untouched"}');
});

it('keeps a valid explicit partial threshold and applies conversion only once', () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-settings-'));
  const file = path.join(directory, 'settings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      discovery: {
        enabledSources: [],
        candidateSupply: { longTerm: { interestMinimumCount: 3 } },
      },
    }),
  );
  migrateRecommendationSettings(file);
  const saved = fs.readFileSync(file, 'utf8');

  expect(JSON.parse(saved).discovery).toMatchObject({
    enabledSources: [],
    candidateSupply: { interestMinimumCount: 3 },
  });
  expect(migrateRecommendationSettings(file).status).toBe('unchanged');
  expect(fs.readFileSync(file, 'utf8')).toBe(saved);
});

it('does not create a legacy settings file for a fresh installation', () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-settings-'));
  const file = path.join(directory, 'settings.json');

  expect(migrateRecommendationSettings(file).status).toBe('unchanged');
  expect(fs.existsSync(file)).toBe(false);
  expect(RecommendationConfigurationSchema.parse({})).toMatchObject({
    enabled: false,
    enabledSources: ['tavily', 'bing_rss', 'zhihu', 'bilibili', 'xiaohongshu'],
  });
});

it('leaves the original file intact after a failed atomic replacement and can retry', () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-settings-'));
  const file = path.join(directory, 'settings.json');
  const original = '{"discovery":{"candidateSupplyConfirmed":true}}';
  fs.writeFileSync(file, original);
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
    throw new Error('Simulated file replacement failure');
  });

  expect(() => migrateRecommendationSettings(file)).toThrow();
  expect(fs.readFileSync(file, 'utf8')).toBe(original);
  expect(fs.readdirSync(directory)).toEqual(['settings.json']);
  expect(migrateRecommendationSettings(file).status).toBe('migrated');
  expect(migrateRecommendationSettings(file).status).toBe('unchanged');
});
