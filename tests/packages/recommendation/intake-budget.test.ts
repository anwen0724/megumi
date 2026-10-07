/*
 * Verifies that each kind of counted work is charged only when it actually runs,
 * that a refused reservation defers work instead of half-saving it, and that a
 * re-match splits by the per-request input instead of failing as one batch.
 */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Context, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { matchPendingInterests } from '@megumi/application/recommendation/candidates/match-interests';
import { estimateAnalysisRequest } from '@megumi/application/recommendation/content/analyze-content';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { intakeContent } from '@megumi/application/recommendation/content/intake-content';
import type { TextModelClient } from '@megumi/application/recommendation/call-text-model';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';

describe('counted work is charged only when it runs', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let models: ReturnType<typeof createModels>;
  let model: Model<Api>;
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    database
      .prepare({
        sql: "INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES ('i1','Rust 异步运行时',1,0,0)",
      })
      .run();
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
  });

  afterEach(() => database.close());

  it('charges nothing for a rejected discovery', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/notext');
    const reserved: unknown[] = [];

    const outcome = await intake({ resultId: 'r1', text: '   ', reserved });

    expect(outcome.status).toBe('rejected');
    expect(reserved).toEqual([]);
  });

  it('charges nothing for a rediscovery of stored content', async () => {
    database
      .prepare({
        sql: `INSERT INTO contents (id, source, canonical_url, text, created_at, updated_at)
              VALUES ('c1','zhihu','https://zhuanlan.zhihu.com/p/1','材料正文',0,0)`,
      })
      .run();
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    const reserved: unknown[] = [];

    const outcome = await intake({ resultId: 'r1', reserved });

    expect(outcome.status).toBe('reused');
    expect(reserved).toEqual([]);
  });

  it('defers a discovery without saving anything when the budget refuses it', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    const reserved: unknown[] = [];

    const outcome = await intake({ resultId: 'r1', reserved, reserve: () => false });

    expect(outcome.status).toBe('deferred');
    // Nothing was saved, so the discovery is still waiting for a later round.
    expect(countRows(database, 'contents')).toBe(0);
    expect(resultStatus(database, 'r1')).toBe('pending');
    expect(reserved).toHaveLength(1);
  });

  it('reserves one call with the size the request will actually cost', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    faux.setResponses([fauxAssistantMessage(analysisJson())]);
    const reserved: { inputTokens: number; outputTokens: number }[] = [];

    const outcome = await intake({ resultId: 'r1', reserved });

    expect(outcome.status).toBe('candidate');
    expect(reserved).toHaveLength(1);
    const expected = estimateAnalysisRequest({
      contentId: 'c1',
      text: MATERIAL,
      title: '标题',
      interests: [{ id: 'i1', revision: 1, text: 'Rust 异步运行时' }],
      model,
      maxInputTokens: 10_000,
      maxOutputTokens: 500,
    });
    expect(reserved[0]).toEqual({
      inputTokens: expected.inputTokens,
      outputTokens: expected.outputTokens,
    });
    expect(reserved[0]!.inputTokens).toBeGreaterThan(0);
    expect(reserved[0]!.inputTokens).toBeLessThan(10_000);
  });

  it('splits a re-match by the request input and charges each batch', async () => {
    for (const id of ['c1', 'c2', 'c3']) {
      seedAnalyzedContent(database, id);
    }
    const prompts: string[] = [];
    const client: TextModelClient = {
      async completeSimple(_model: Model<Api>, context: Context) {
        const prompt = promptOf(context);
        prompts.push(prompt);
        const contentId = /contentId=(\w+)/u.exec(prompt)?.[1] ?? 'c1';
        return fauxAssistantMessage(
          JSON.stringify({
            matches: [
              { contentId, interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' },
            ],
          }),
        );
      },
    };
    let reservedCalls = 0;

    const outcome = await matchPendingInterests(
      { client, contents: createContentStorage(database), candidates: createCandidateStorage(database) },
      {
        interests: [{ id: 'i1', revision: 1, text: 'Rust 异步运行时' }],
        model,
        callBudget: 5,
        // The prompt header alone fills one request, so every content needs its own.
        maxInputTokens: 40,
        maxOutputTokens: 10,
        reserveMatchingCall: () => {
          reservedCalls += 1;
          return true;
        },
        now: NOW,
      },
    );

    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') throw new Error('expected a completed match');
    expect(outcome.deferred).toBe(false);
    expect(outcome.matchedContents).toBe(3);
    expect(prompts).toHaveLength(3);
    expect(reservedCalls).toBe(3);
    expect(countRows(database, 'content_interest_matches')).toBe(3);
  });

  it('stops re-matching and reports it when the call budget runs out', async () => {
    for (const id of ['c1', 'c2']) {
      seedAnalyzedContent(database, id);
    }
    const client: TextModelClient = {
      async completeSimple(_model: Model<Api>, context: Context) {
        const contentId = /contentId=(\w+)/u.exec(promptOf(context))?.[1] ?? 'c1';
        return fauxAssistantMessage(
          JSON.stringify({
            matches: [{ contentId, interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' }],
          }),
        );
      },
    };
    let remaining = 1;

    const outcome = await matchPendingInterests(
      { client, contents: createContentStorage(database), candidates: createCandidateStorage(database) },
      {
        interests: [{ id: 'i1', revision: 1, text: 'Rust 异步运行时' }],
        model,
        callBudget: 5,
        maxInputTokens: 120,
        maxOutputTokens: 20,
        reserveMatchingCall: () => {
          if (remaining === 0) return false;
          remaining -= 1;
          return true;
        },
        now: NOW,
      },
    );

    expect(outcome).toMatchObject({ status: 'ok', deferred: true, matchedContents: 1 });
    expect(countRows(database, 'content_interest_matches')).toBe(1);
  });

  async function intake(input: {
    readonly resultId: string;
    readonly text?: string;
    readonly reserved: { inputTokens: number; outputTokens: number }[];
    readonly reserve?: () => boolean;
  }) {
    return intakeContent(
      {
        client: models,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        newContentId: () => `c${++sequence}`,
      },
      {
        item: {
          source: 'zhihu',
          url: urlOf(database, input.resultId),
          title: '标题',
          ...(input.text === undefined ? { text: MATERIAL } : { text: input.text }),
          publishedAt: NOW - 60_000,
        },
        sourceResultId: input.resultId,
        interests: [{ id: 'i1', revision: 1, text: 'Rust 异步运行时' }],
        model,
        contentLanguages: [],
        maxInputTokens: 10_000,
        maxOutputTokens: 500,
        freshnessDays: 7,
        reserveAnalysis: (estimate) => {
          input.reserved.push({
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
          });
          return input.reserve ? input.reserve() : true;
        },
        now: NOW,
      },
    );
  }
});

function analysisJson(): string {
  return JSON.stringify({
    summary: 'Tokio 是 Rust 的异步运行时。',
    keyPoints: [{ text: '提供异步调度', evidence: 'Tokio 运行时提供异步任务调度与超时控制' }],
    topics: ['异步'],
    entities: ['Tokio'],
    contentType: 'article',
    qualityScore: 0.6,
    spamScore: 0.1,
    longTermValue: 'learning',
    matches: [{ interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' }],
  });
}

/** Stores one content whose analysis is complete and whose interest is unjudged. */
function seedAnalyzedContent(database: DatabaseConnection, contentId: string): void {
  database
    .prepare({
      sql: `INSERT INTO contents (id, source, canonical_url, text, created_at, updated_at)
            VALUES (?, 'zhihu', ?, '材料正文', 0, 0)`,
    })
    .run([contentId, `https://example.com/${contentId}`]);
  database
    .prepare({
      sql: `INSERT INTO content_analysis
              (content_id, summary, key_points, topics, entities, content_type, quality_score,
               spam_score, long_term_value, status, attempts, analyzed_at)
            VALUES (?, '摘要', '[{"text":"要点","evidence":"材料正文"}]', '["主题"]', '["实体"]',
                    'article', 0.6, 0.1, 'learning', 'ready', 1, 0)`,
    })
    .run([contentId]);
}

function seedResult(database: DatabaseConnection, id: string, url: string): void {
  database
    .prepare({
      sql: `INSERT INTO search_results (id, source, url, status, attempts, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, 'pending', 0, 0, 0)`,
    })
    .run([id, url]);
}

function urlOf(database: DatabaseConnection, id: string): string {
  const row = database
    .prepare<{ url: string }>({ sql: 'SELECT url FROM search_results WHERE id = ?' })
    .get([id]);
  if (!row) throw new Error('expected a stored discovery');
  return row.url;
}

function resultStatus(database: DatabaseConnection, id: string): string {
  const row = database
    .prepare<{ status: string }>({ sql: 'SELECT status FROM search_results WHERE id = ?' })
    .get([id]);
  if (!row) throw new Error('expected a stored discovery');
  return row.status;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}

/** The user prompt one text-model call carries. */
function promptOf(context: Context): string {
  const content = context.messages[0]?.content;
  if (typeof content === 'string') return content;
  return (content ?? [])
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n');
}
