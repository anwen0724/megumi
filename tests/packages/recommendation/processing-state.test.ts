/*
 * Verifies that every discovery ends in a recorded state. A rejected or reused
 * discovery must stop being "pending", a first analysis failure must be saved as
 * a failure, and unfinished work must be retried only within its retry limit.
 */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { intakeContent } from '@megumi/application/recommendation/content/intake-content';
import { pruneUnusedContent } from '@megumi/application/recommendation/content/prune-content';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const NOW = 1_800_000_000_000;
const MATERIAL = 'Tokio 运行时提供异步任务调度与超时控制，这段文本用于关键点证据比对。';

describe('discovery processing state', () => {
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

  it('records a rejected discovery as rejected with its reason', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/notext');

    const outcome = await intake({ sourceResultId: 'r1', text: '   ' });

    expect(outcome.status).toBe('rejected');
    expect(resultRow(database, 'r1')).toEqual({
      status: 'rejected',
      lastErrorCode: 'no_text',
      contentId: null,
    });
  });

  it('records a rediscovered URL as normalized and links the stored content', async () => {
    // The library already holds the article under this canonical URL, and a new
    // discovery row for it is still pending.
    database
      .prepare({
        sql: `INSERT INTO contents (id, source, canonical_url, title, text, created_at, updated_at)
              VALUES ('c1','zhihu','https://zhuanlan.zhihu.com/p/1','标题','材料正文',0,0)`,
      })
      .run();
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    faux.setResponses([]);

    const outcome = await intake({ sourceResultId: 'r1' });

    expect(outcome.status).toBe('reused');
    expect(resultRow(database, 'r1')).toEqual({
      status: 'normalized',
      lastErrorCode: null,
      contentId: 'c1',
    });
  });

  it('records a first analysis failure instead of leaving the analysis pending', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    faux.setResponses([fauxAssistantMessage('not json at all')]);

    const outcome = await intake({
      sourceResultId: 'r1',
      analysisRetryAt: () => NOW + 60_000,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('expected a failed intake');
    expect(analysisRow(database, outcome.contentId)).toEqual({
      status: 'failed',
      attempts: 1,
      retryAt: NOW + 60_000,
      lastErrorCode: 'INVALID_RESULT',
    });
  });

  it('records a material that cannot be analyzed as a terminal failure', async () => {
    seedResult(database, 'r1', 'https://zhuanlan.zhihu.com/p/1');
    faux.setResponses([]);

    // The material itself is too long, so another attempt would read the same text.
    const outcome = await intake({
      sourceResultId: 'r1',
      maxInputTokens: 1,
      analysisRetryAt: () => undefined,
    });

    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') throw new Error('expected a failed intake');
    expect(analysisRow(database, outcome.contentId)).toEqual({
      status: 'failed',
      attempts: 1,
      retryAt: null,
      lastErrorCode: 'MATERIAL_TOO_LONG',
    });
  });

  it('retries a failed analysis only while it is under the retry limit', () => {
    const contents = createContentStorage(database);
    seedContentWithAnalysis(database, 'c1', 'failed', 1, NOW - 1);

    expect(
      contents.listAnalysesDueForRetry({ limit: 10, now: NOW, maxAttempts: 3 }),
    ).toEqual(['c1']);

    database
      .prepare({ sql: "UPDATE content_analysis SET attempts = 3 WHERE content_id = 'c1'" })
      .run();
    expect(
      contents.listAnalysesDueForRetry({ limit: 10, now: NOW, maxAttempts: 3 }),
    ).toEqual([]);
  });

  it('reports pending analyses an earlier round left behind', () => {
    const contents = createContentStorage(database);
    seedContentWithAnalysis(database, 'c1', 'pending', 0, null);
    seedContentWithAnalysis(database, 'c2', 'pending', 3, null);

    expect(contents.listPendingAnalyses({ limit: 10, maxAttempts: 3 })).toEqual(['c1']);
  });

  it('keeps content whose analysis failed and still has retries left', async () => {
    seedContentWithAnalysis(database, 'c1', 'failed', 1, null);

    const outcome = await pruneUnusedContent(
      {
        database,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        retention: { findRetainedContentIds: async () => [] },
      },
      { batchSize: 10 },
    );

    expect(outcome.removedContents).toBe(0);
    expect(countRows(database, 'contents')).toBe(1);
  });

  it('removes content only once its analysis is ready', async () => {
    seedContentWithAnalysis(database, 'c1', 'ready', 1, null);
    // The interest was already judged, so nothing is waiting for a match.
    database
      .prepare({
        sql: `INSERT INTO content_interest_matches (content_id, interest_id, relation, matched_at)
              VALUES ('c1','i1','none',0)`,
      })
      .run();

    const outcome = await pruneUnusedContent(
      {
        database,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        retention: { findRetainedContentIds: async () => [] },
      },
      { batchSize: 10 },
    );

    expect(outcome.removedContents).toBe(1);
  });

  async function intake(input: {
    readonly sourceResultId: string;
    readonly text?: string;
    readonly analysisRetryAt?: (failureCode: string) => number | undefined;
    readonly maxInputTokens?: number;
  }) {
    const outcome = await intakeContent(
      {
        client: models,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        newContentId: () => `c${++sequence}`,
      },
      {
        item: {
          source: 'zhihu',
          url: urlOf(database, input.sourceResultId),
          title: '标题',
          ...(input.text === undefined ? { text: MATERIAL } : { text: input.text }),
          publishedAt: NOW - 60_000,
        },
        sourceResultId: input.sourceResultId,
        interests: [{ id: 'i1', text: 'Rust 异步运行时' }],
        model,
        contentLanguages: [],
        maxInputTokens: input.maxInputTokens ?? 10_000,
        maxOutputTokens: 500,
        freshnessDays: 7,
        ...(input.analysisRetryAt === undefined ? {} : { analysisRetryAt: input.analysisRetryAt }),
        now: NOW,
      },
    );
    return outcome;
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

function seedContentWithAnalysis(
  database: DatabaseConnection,
  contentId: string,
  status: string,
  attempts: number,
  retryAt: number | null,
): void {
  database
    .prepare({
      sql: `INSERT INTO contents (id, source, canonical_url, text, created_at, updated_at)
            VALUES (?, 'zhihu', ?, '材料正文', 0, 0)`,
    })
    .run([contentId, `https://example.com/${contentId}`]);
  database
    .prepare({
      sql: `INSERT INTO content_analysis (content_id, status, attempts, retry_at, analyzed_at)
            VALUES (?, ?, ?, ?, ?)`,
    })
    .run([contentId, status, attempts, retryAt, status === 'ready' ? NOW : null]);
}

function resultRow(
  database: DatabaseConnection,
  id: string,
): { status: string; lastErrorCode: string | null; contentId: string | null } {
  const row = database
    .prepare<{ status: string; last_error_code: string | null; content_id: string | null }>({
      sql: 'SELECT status, last_error_code, content_id FROM search_results WHERE id = ?',
    })
    .get([id]);
  if (!row) throw new Error('expected a stored discovery');
  return { status: row.status, lastErrorCode: row.last_error_code, contentId: row.content_id };
}

function analysisRow(
  database: DatabaseConnection,
  contentId: string,
): { status: string; attempts: number; retryAt: number | null; lastErrorCode: string | null } {
  const row = database
    .prepare<{ status: string; attempts: number; retry_at: number | null; last_error_code: string | null }>({
      sql: 'SELECT status, attempts, retry_at, last_error_code FROM content_analysis WHERE content_id = ?',
    })
    .get([contentId]);
  if (!row) throw new Error('expected a stored analysis');
  return {
    status: row.status,
    attempts: row.attempts,
    retryAt: row.retry_at,
    lastErrorCode: row.last_error_code,
  };
}

function contentId(database: DatabaseConnection, url: string): string {
  const row = database
    .prepare<{ id: string }>({ sql: 'SELECT id FROM contents WHERE canonical_url = ?' })
    .get([url]);
  if (!row) throw new Error('expected a stored content');
  return row.id;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
