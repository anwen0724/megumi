/* Verifies one discovery reaches a candidate through analysis and deduplication. */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Model } from '@megumi/ai';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { analyzeContent } from '@megumi/application/recommendation/content/analyze-content';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import { intakeContent } from '@megumi/application/recommendation/content/intake-content';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MATERIAL = '这里包含正文片段以及别的内容。';

function analysisJson(overrides: Record<string, unknown> = {}): string {
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
    ...overrides,
  });
}

describe('content analysis', () => {
  let database: DatabaseConnection;
  let faux: ReturnType<typeof fauxProvider>;
  let models: ReturnType<typeof createModels>;
  let model: Model<Api>;

  beforeEach(() => {
    database = openDatabase();
    faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
  });

  afterEach(() => database.close());

  it('keeps only key points whose evidence appears in the material', async () => {
    faux.setResponses([
      fauxAssistantMessage(
        analysisJson({
          keyPoints: [
            { text: '有依据', evidence: '正文片段' },
            { text: '编造', evidence: '材料里没有的句子' },
          ],
          matches: [
            { interestId: 'i1', relation: 'direct', basis: '相关' },
            { interestId: 'unknown', relation: 'none' },
          ],
        }),
      ),
    ]);

    const result = await analyzeContent(models, {
      contentId: 'c1',
      text: MATERIAL,
      interests: [{ id: 'i1', text: '摄影' }],
      model,
      maxInputTokens: 10_000,
      maxOutputTokens: 500,
    });

    expect(result.status).toBe('analyzed');
    if (result.status !== 'analyzed') throw new Error('expected an analysis');
    expect(result.analysis.keyPoints).toEqual([{ text: '有依据', evidence: '正文片段' }]);
    expect(result.matches).toEqual([{ interestId: 'i1', relation: 'direct', basis: '相关' }]);
  });

  it('reports material too long instead of silently truncating it', async () => {
    const result = await analyzeContent(models, {
      contentId: 'c1',
      text: '很长的材料'.repeat(500),
      interests: [],
      model,
      maxInputTokens: 100,
      maxOutputTokens: 50,
    });

    expect(result.status).toBe('material_too_long');
  });

  describe('intake', () => {
    let sequence = 0;

    beforeEach(() => {
      sequence = 0;
      createInterestStorage(database).create({ id: 'i1', text: '摄影', now: 1 });
    });

    function dependencies() {
      return {
        client: models,
        contents: createContentStorage(database),
        candidates: createCandidateStorage(database),
        newContentId: () => `c${++sequence}`,
      };
    }

    function intakeInput(url: string, text = MATERIAL) {
      insertSearchResult(database, 'r1', url);
      return {
        item: { source: 'zhihu', url, title: '标题', text },
        sourceResultId: 'r1',
        interests: [{ id: 'i1', text: '摄影' }],
        model,
        contentLanguages: [] as readonly string[],
        maxInputTokens: 10_000,
        maxOutputTokens: 500,
        pool: 'daily' as const,
        now: 2,
      };
    }

    it('stores material, its analysis, and a candidate for the current interest', async () => {
      faux.setResponses([fauxAssistantMessage(analysisJson())]);

      const outcome = await intakeContent(
        dependencies(),
        intakeInput('https://zhuanlan.zhihu.com/p/1?utm_medium=openapi_platform'),
      );

      expect(outcome.status).toBe('candidate');
      if (outcome.status !== 'candidate') throw new Error('expected a candidate');
      expect(outcome.committedPools).toEqual(['daily']);
      expect(countRows(database, 'contents')).toBe(1);
      expect(countRows(database, 'content_analysis')).toBe(1);
      expect(countRows(database, 'content_interest_matches')).toBe(1);
      expect(countRows(database, 'recommendation_candidates')).toBe(1);
    });

    it('reuses the stored content when the same canonical URL is discovered again', async () => {
      faux.setResponses([fauxAssistantMessage(analysisJson())]);
      const dependenciesOnce = dependencies();

      const first = await intakeContent(
        dependenciesOnce,
        intakeInput('https://zhuanlan.zhihu.com/p/1'),
      );
      const second = await intakeContent(
        dependenciesOnce,
        intakeInput('https://zhuanlan.zhihu.com/p/1?utm_source=somewhere'),
      );

      expect(first.status).toBe('candidate');
      expect(second.status).toBe('reused');
      expect(countRows(database, 'contents')).toBe(1);
    });

    it('reuses a saved analysis when the text is identical under another URL', async () => {
      faux.setResponses([fauxAssistantMessage(analysisJson())]);
      const dependenciesOnce = dependencies();
      await intakeContent(dependenciesOnce, intakeInput('https://zhuanlan.zhihu.com/p/1'));
      const callsAfterFirst = faux.state.callCount;

      const second = await intakeContent(
        dependenciesOnce,
        intakeInput('https://zhuanlan.zhihu.com/p/2'),
      );

      expect(second.status).toBe('candidate');
      if (second.status !== 'candidate') throw new Error('expected a candidate');
      expect(second.reusedAnalysis).toBe(true);
      expect(faux.state.callCount).toBe(callsAfterFirst);
      expect(duplicateGroupOf(database, second.contentId)).toBe('c1');
      expect(countRows(database, 'content_interest_matches')).toBe(2);
    });

    it('rejects a discovery that carries no usable text', async () => {
      const outcome = await intakeContent(dependencies(), {
        ...intakeInput('https://zhuanlan.zhihu.com/p/3', '   '),
      });

      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('expected a rejection');
      expect(outcome.reason).toBe('no_text');
      expect(countRows(database, 'contents')).toBe(0);
    });
  });
});

function openDatabase(): DatabaseConnection {
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  return database;
}

function insertSearchResult(database: DatabaseConnection, id: string, url: string): void {
  database
    .prepare({
      sql: `INSERT OR IGNORE INTO search_results (id, source, url, status, attempts, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, 'pending', 0, 0, 0)`,
    })
    .run([id, url]);
}

function duplicateGroupOf(database: DatabaseConnection, contentId: string): string | undefined {
  return database
    .prepare<{ duplicate_group_id: string | null }>({
      sql: 'SELECT duplicate_group_id FROM contents WHERE id = ?',
    })
    .get([contentId])?.duplicate_group_id ?? undefined;
}

function countRows(database: DatabaseConnection, table: string): number {
  const rows = database
    .prepare<{ total: number }>({ sql: `SELECT count(*) AS total FROM ${table}` })
    .all();
  return rows[0]?.total ?? 0;
}
