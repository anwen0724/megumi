/*
 * Verifies the production single-pool supply using real persistence and network/model substitutes.
 */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import { createRecommendation } from '@megumi/application/recommendation/recommendation-api';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';
import { createSettings } from '@megumi/application/settings/settings-store';
import { migrateRecommendationSettings } from '@megumi/application/settings/recommendation-settings-migration';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';
it('supplies one current candidate from acquired material and retains it across owner restart', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reliable-supply-'));
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const settingsPath = path.join(directory, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ discovery: { candidateSupplyConfirmed: true, enabledSources: ['tavily'], candidateSupplyModel: { providerId: 'faux', modelId: 'supply' } } }));
  migrateRecommendationSettings(settingsPath);
  const settings = createSettings({ globalSettingsPath: settingsPath, credentialsPath: path.join(directory, 'credentials.json'), readEnvironment: () => undefined });
  const faux = fauxProvider({ models: [{ id: 'supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'supply')!;
  const requests: string[] = [];
  let sequence = 0;
  const options = {
    database, settings, resolveModel: async () => model, accessSecret: () => 'secret',
    newId: (prefix: string) => `${prefix}-${++sequence}`, now: () => 1800000000000,
    observability: { withTrace: async (_scope: unknown, work: () => Promise<unknown>) => work(), withSpan: async (_scope: unknown, work: () => Promise<unknown>) => work(), recordContent() { }, recordEvent() { }, linkTrace() { } },
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    sourceFetch: async (input: string | URL | Request) => {
      requests.push(new URL(String(input)).pathname);
      return Response.json({ results: [{ url: 'https://example.com/interview', title: '面试', content: '具体准备方法', raw_content: '完整正文包含面试的具体准备方法。' }], failed_results: [] });
    },
    client: {
      async completeSimple(_model: unknown, context: {
        messages: readonly {
          content: unknown;
        }[];
      }) {
        const prompt = JSON.parse(String(context.messages[0]?.content));
        if (prompt.stage === 'planning')
          return fauxAssistantMessage(JSON.stringify({ items: [{ interestId: prompt.interests[0].id, sourceId: 'tavily', query: '面试准备', direction: 'direct', basis: '直接覆盖求职需求' }] }));
        return fauxAssistantMessage(JSON.stringify({
          items: prompt.items.map((item: {
            id: string;
            materialId: string;
            text: string;
            contentId: string;
            interestId?: string;
          }) => ({
            id: item.id, result: prompt.stage === 'analysis' ? {
              summary: '说明具体面试准备方法', keyPoints: [{ text: '准备方法', evidence: [{ materialId: item.materialId, quote: '具体准备方法' }] }], topics: ['面试'], contentType: 'article', qualityScore: 0.8, spamScore: 0, timeScope: { kind: 'unknown', evidence: [] },
            } : { relation: 'direct', status: 'eligible', basis: '提供面试方法', evidence: [{ materialId: item.materialId, quote: '具体准备方法' }] }
          }))
        }));
      }
    },
  };
  let recommendation = createRecommendation(options);
  onTestFinished(async () => { await recommendation.shutdown(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await recommendation.interests.createInterest({ text: '求职面试' });
  const round = await recommendation.supply.startMaintenance({ reason: 'startup' }).result;
  const snapshot = await recommendation.supply.listCandidates({});
  expect(snapshot.candidates, JSON.stringify(round)).toHaveLength(1);
  expect(createMaterialStorage(database).readCurrentMaterial(snapshot.candidates[0]!.contentId)?.text).toContain('具体准备方法');
  expect(requests).toEqual(['/search']);
  await recommendation.shutdown();
  recommendation = createRecommendation(options);
  expect((await recommendation.supply.listCandidates({})).candidates).toHaveLength(1);
  expect(requests).toEqual(['/search']);
});
