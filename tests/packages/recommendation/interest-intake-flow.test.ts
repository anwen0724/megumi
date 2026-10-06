/* Verifies one interest reaches stored candidates through search and analysis. */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { intakeContent } from '@megumi/application/recommendation/content/intake-content';
import { executeInterestSearch } from '@megumi/application/recommendation/discovery/execute-searches';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import { createZhihuSource } from '@megumi/application/recommendation/sources/zhihu-source';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MATERIAL = '这里包含正文片段以及别的内容。';
const CONTENT_URL = 'https://zhuanlan.zhihu.com/p/1?utm_medium=openapi_platform';

describe('interest intake flow', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let models: ReturnType<typeof createModels>;
  let model: Model<Api>;
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
    createInterestStorage(database).create({ id: 'i1', text: '摄影', now: 1 });
  });

  afterEach(() => database.close());

  it('turns one interest into a stored candidate without search planning', async () => {
    faux.setResponses([fauxAssistantMessage(analysisJson())]);
    const searched = await search();

    expect(searched.status).toBe('success');
    if (searched.status !== 'success') throw new Error('expected a search');
    expect(searched.items).toHaveLength(1);

    const outcome = await intake(searched.items[0].resultId, searched.items[0].item);

    expect(outcome).toBe('candidate');
    expect(queryOrigin(database)).toBe('interest');
    expect(countRows(database, 'search_queries')).toBe(1);
    expect(countRows(database, 'contents')).toBe(1);
    expect(countRows(database, 'content_analysis')).toBe(1);
    expect(countRows(database, 'content_interest_matches')).toBe(1);
    expect(countRows(database, 'recommendation_candidates')).toBe(1);
  });

  it('reuses the stored interest query on the next run instead of adding another', async () => {
    faux.setResponses([fauxAssistantMessage(analysisJson()), fauxAssistantMessage(analysisJson())]);

    await search();
    await search();

    expect(countRows(database, 'search_queries')).toBe(1);
    expect(countRows(database, 'search_results')).toBe(1);
  });

  function source() {
    return createZhihuSource({
      accessSecret: () => 'secret',
      fetch: async () =>
        new Response(
          JSON.stringify({
            Code: 0,
            Message: 'success',
            Data: {
              Items: [
                {
                  Title: '标题',
                  ContentID: '1',
                  ContentText: MATERIAL,
                  Url: CONTENT_URL,
                  AuthorName: '作者',
                  EditTime: 1791161176,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    });
  }

  function search() {
    return executeInterestSearch(
      {
        database,
        source: source(),
        newQueryId: () => `q${++sequence}`,
        newResultId: () => `r${++sequence}`,
      },
      { interestId: 'i1', interestText: '摄影', limit: 10, now: 2 },
    );
  }

  async function intake(sourceResultId: string, item: Parameters<typeof intakeContent>[1]['item']) {
    const outcome = await intakeContent(
      {
        client: models,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        newContentId: () => `c${++sequence}`,
      },
      {
        item,
        sourceResultId,
        interests: [{ id: 'i1', text: '摄影' }],
        model,
        contentLanguages: [],
        maxInputTokens: 10_000,
        maxOutputTokens: 500,
        pool: 'daily',
        now: 3,
      },
    );
    return outcome.status;
  }
});

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

function queryOrigin(database: DatabaseConnection): string | undefined {
  return database
    .prepare<{ origin: string }>({ sql: 'SELECT origin FROM search_queries LIMIT 1' })
    .get()?.origin;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
