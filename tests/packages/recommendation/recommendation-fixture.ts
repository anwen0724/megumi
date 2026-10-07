/*
 * Composes real recommendation owners with controlled time and external protocol substitutes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { createModels, fauxAssistantMessage, fauxProvider } from '@megumi/ai';
import { createDatabase, migrateDatabase } from '@megumi/application/storage/index';
import { createSettings } from '@megumi/application/settings/settings-store';
import { createRecommendation } from '@megumi/application/recommendation/recommendation-api';
import { createMaterialStorage } from '@megumi/application/recommendation/content/material-storage';
import { createCandidateQualificationStorage } from '@megumi/application/recommendation/candidates/candidate-qualification-storage';
import type { RecommendationConfiguration } from '@megumi/application/settings/definitions/recommendation';
import type { WebFetch } from '@megumi/agent';
export interface ModelPrompt {
  stage: string;
  items?: {
    id: string;
    materialId: string;
    text?: string;
    interestId?: string;
    contentId?: string;
  }[];
  interests?: {
    id: string;
  }[];
}
/** Tests own HTTP/model outcomes; material, qualification, migrations and lifecycle stay real. */
export function recommendationFixture(options: {
  config?: Partial<RecommendationConfiguration>;
  respond?: (prompt: ModelPrompt) => Promise<unknown>;
  fetch?: typeof globalThis.fetch;
  webFetch?: WebFetch;
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recommendation-owner-'));
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const settingsPath = path.join(directory, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ discovery: { enabled: true, enabledSources: ['tavily'], candidateSupplyModel: { providerId: 'faux', modelId: 'supply' }, ...options.config } }));
  const settings = createSettings({ globalSettingsPath: settingsPath, credentialsPath: path.join(directory, 'credentials.json'), readEnvironment: () => undefined });
  const faux = fauxProvider({ models: [{ id: 'supply' }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = models.getModel(faux.provider.id, 'supply')!;
  const requests: string[] = [];
  const prompts: ModelPrompt[] = [];
  let time = Date.parse('2026-10-07T09:00:00+08:00');
  let sequence = 0;
  const now = () => time;
  const newId = (prefix: string) => `${prefix}-${++sequence}`;
  const materials = createMaterialStorage(database, () => newId('material'));
  const candidates = createCandidateQualificationStorage(database, () => newId('match'));
  const defaultRespond = (prompt: ModelPrompt) => prompt.stage === 'planning' ? { items: prompt.interests!.map(i => ({ interestId: i.id, sourceId: 'tavily', query: '面试准备', direction: 'direct', basis: '对应用户原文' })) } : { items: prompt.items!.map(item => ({ id: item.id, result: prompt.stage === 'analysis' ? { summary: '面试的准备方法', keyPoints: [{ text: '面试方法', evidence: [{ materialId: item.materialId, quote: '准备方法' }] }], topics: ['面试'], contentType: 'article', qualityScore: 0.8, spamScore: 0, timeScope: { kind: 'unknown', evidence: [] } } : { relation: 'direct', status: 'eligible', basis: '符合面试需求', evidence: [{ materialId: item.materialId, quote: '准备方法' }] } })) };
  const ownerOptions = {
    sourceWebFetch: options.webFetch ?? { async fetch() { return { url: 'https://example.com/interview', content: '完整正文包含面试的准备方法。', contentType: 'text/html', truncated: false, document: '<article>完整正文包含面试的准备方法。</article>' }; } },
    database, settings, newId, now, resolveModel: async () => model, accessSecret: () => 'secret',
    observability: { withTrace: async <T>(_scope: unknown, work: () => Promise<T>) => work(), withSpan: async <T>(_scope: unknown, work: () => Promise<T>) => work(), recordContent() { }, recordEvent() { }, linkTrace() { } },
    timers: { setTimeout: () => 0, clearTimeout: () => undefined },
    sourceFetch: async (input: string | URL | Request, init?: RequestInit) => { requests.push(new URL(String(input)).pathname); return options.fetch ? options.fetch(input, init) : Response.json({ results: [{ url: 'https://example.com/interview', title: '面试', content: '准备方法', raw_content: '完整正文包含面试的准备方法。' }], failed_results: [] }); },
    client: {
      async completeSimple(_model: unknown, context: {
        messages: readonly {
          content: unknown;
        }[];
      }) { const prompt: ModelPrompt = JSON.parse(String(context.messages[0]?.content)); prompts.push(prompt); return fauxAssistantMessage(JSON.stringify(options.respond ? await options.respond(prompt) : defaultRespond(prompt))); }
    },
  };
  let owner = createRecommendation(ownerOptions);
  onTestFinished(async () => { await owner.shutdown(); database.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return {
    database, settings, materials, candidates, requests, prompts, now, newId, defaultRespond, model, client: ownerOptions.client,
    get owner() { return owner; }, advance(ms: number) { time += ms; },
    async restart() { await owner.shutdown(); owner = createRecommendation(ownerOptions); return owner; }
  };
}
