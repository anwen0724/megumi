/* Verifies real production composition acquires and persists material before analysis. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it, onTestFinished } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import { createRecommendation } from '@megumi/application/recommendation/recommendation-api';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { createSettings } from '@megumi/application/settings/settings-store';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';

it('acquires full text through the configured sources and saves it as actual material', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'source-supply-'));
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const settings = createSettings({
    globalSettingsPath: path.join(directory, 'settings.json'),
    credentialsPath: path.join(directory, 'credentials.json'),
    readEnvironment: () => undefined
  });
  const read = settings.readSettings();
  if (read.status === 'rejected') throw new Error(read.error.message);
  settings.updateSettings({
    expectedRevision: read.settings.revision, patch: {
      discovery: {
        enabledSources: ['tavily'],
        candidateSupplyConfirmed: true,
        candidateSupplyModel: { providerId: 'faux', modelId: 'supply' }
      }
    }
  });
  const faux = fauxProvider({ models: [{ id: 'supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'supply');
  if (!model) throw new Error('Expected model');
  const acquired: string[] = [];
  let sequence = 0;
  const recommendation = createRecommendation({
    database,
    settings,
    client: {
      async completeSimple(_model, context) {
        const system = context.systemPrompt ?? '';
        if (system.includes('You plan searches')) return fauxAssistantMessage(JSON.stringify({
          items: [{
            interestId: 'interest-1',
            pools: ['long_term'],
            source: 'tavily',
            priority: 1,
            query: '面试'
          }]
        }));
        if (system.includes('You decide whether')) return fauxAssistantMessage(JSON.stringify({ decisions: [] }));
        const prompt = String(context.messages[0]?.content ?? '');
        expect(prompt).toContain('完整正文及其证据');
        return fauxAssistantMessage(JSON.stringify({
          summary: '摘要',
          keyPoints: [{ text: '要点', evidence: '完整正文及其证据' }],
          topics: ['面试'],
          entities: [],
          contentType: 'article',
          qualityScore: 0.8,
          spamScore: 0,
          longTermValue: 'learning',
          matches: [{ interestId: 'interest-1', relation: 'direct', basis: '求职' }]
        }));
      },
    },
    resolveModel: async () => model,
    accessSecret: () => 'secret',
    newId: (prefix) => prefix === 'interest' ? 'interest-1' : `${prefix}-${++sequence}`,
    now: () => 1800000000000,
    observability: {
      withTrace: async (_scope, work) => work(),
      withSpan: async (_scope, work) => work(),
      recordContent() { },
      recordEvent() { },
      linkTrace() { }
    },
    sourceFetch: async (input) => {
      const operation = new URL(String(input)).pathname;
      acquired.push(operation);
      return operation === '/search' ? Response.json({ results: [{ url: 'https://example.com/interview', title: '面试', content: '搜索摘要' }] }) : Response.json({ results: [{ url: 'https://example.com/interview', raw_content: '完整正文及其证据' }], failed_results: [] });
    },
    timers: { setTimeout: () => 0, clearTimeout: () => undefined }
  });
  onTestFinished(async () => { await recommendation.shutdown(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  await recommendation.host.changeInterest({ action: 'create', description: '求职面试' });
  const round = await recommendation.supply.startMaintenance({ reason: 'startup' }).result;
  expect(acquired, JSON.stringify(round)).toContain('/extract');
  const snapshot = await recommendation.supply.listCandidates({ requirement: { pool: 'long_term', minimumCount: 1, coverage: [] } });
  expect(snapshot.candidates).toHaveLength(1);
  const id = snapshot.candidates[0]!.contentId;
  expect(createContentStorage(database).readCurrentMaterial(id)).toMatchObject({ text: '完整正文及其证据', kind: 'full_text', method: 'tavily_extract', rangeEnd: 8 });
  expect(acquired).toEqual(['/search', '/extract']);
});
