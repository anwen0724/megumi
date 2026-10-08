/*
 * Verifies an existing settings.json written before the Candidate Supply switch
 * still loads. The discovery section used to carry recommendation generation,
 * preference learning and single-pool capacity fields; the schema is strict
 * now, so the upgrade must drop those keys instead of rejecting the file and
 * blocking product startup.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateRecommendationSettings } from '@megumi/application/settings/recommendation-settings-migration';
import { createSettings } from '@megumi/application/settings/settings-store';

describe('settings written before the candidate supply switch', () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-settings-upgrade-'));
  });

  afterEach(() => {
    fs.rmSync(directory, {
      recursive: true,
      force: true,
    });
  });

  it('loads and keeps the supply settings while dropping removed discovery fields', () => {
    writeSettings({
      candidateSupplyConfirmed: true,
      enabledSources: ['bilibili', 'xiaohongshu', 'zhihu'],
      candidateSupplyModel: {
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
      },
      recommendationModel: {
        providerId: 'deepseek',
        modelId: 'deepseek-flash',
      },
      conversationRecognitionEnabled: false,
      recommendationGenerationTime: '08:00',
      recommendationCandidateCheckIntervalSeconds: 60,
      recommendationTargetCount: 20,
      recommendationWorkingSetCount: 80,
      candidatePoolMinimumCount: 100,
      candidatePoolMaximumCount: 200,
      candidateValidityDays: 30,
      candidateContentExcerptMaxCharacters: 8000,
      candidateSupplyCheckIntervalMinutes: 360,
      twitterBudget: {
        maxSearchCalls: 3,
        maxResultsPerSearch: 20,
        maxResultsPerAttempt: 40,
      },
    });

    const settings = create();
    const read = settings.readSettings();

    if (read.status === 'rejected') throw new Error(read.error.message);

    const discovery = read.settings.config.discovery;

    expect(discovery.enabled).toBe(true);
    expect(discovery.candidateSupplyModel).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-flash',
    });
    // The user disabled nothing explicitly, so their saved source list is kept as written.
    expect(discovery.enabledSources).toEqual(['bilibili', 'xiaohongshu', 'zhihu']);
    expect(discovery.dailyFeed.lookbackDays).toBe(3);
    expect(discovery.limits).not.toHaveProperty('maxEmbeddingCalls');

    for (const removed of [
      'recommendationModel',
      'conversationRecognitionEnabled',
      'recommendationGenerationTime',
      'recommendationTargetCount',
      'candidatePoolMinimumCount',
      'candidateValidityDays',
      'twitterBudget',
    ]) {
      expect(discovery).not.toHaveProperty(removed);
    }
  });

  it('loads a settings file that never had a supply section', () => {
    writeSettings({
      recommendationTargetCount: 20,
      candidatePoolMinimumCount: 100,
    });

    const settings = create();
    const read = settings.readSettings();

    if (read.status === 'rejected') throw new Error(read.error.message);

    const discovery = read.settings.config.discovery;

    expect(discovery.enabled).toBe(false);
    expect(discovery.enabledSources).toEqual(['zhihu']);
    expect(discovery.candidateSupplyModel).toBeUndefined();
  });

  function writeSettings(discovery: Record<string, unknown>): void {
    fs.writeFileSync(
      path.join(directory, 'settings.json'),
      JSON.stringify({ discovery }, null, 2),
      'utf8',
    );
  }

  function create() {
    migrateRecommendationSettings(path.join(directory, 'settings.json'));
    return createSettings({
      globalSettingsPath: path.join(directory, 'settings.json'),
      credentialsPath: path.join(directory, 'credentials.json'),
      readEnvironment: () => undefined,
    });
  }
});
