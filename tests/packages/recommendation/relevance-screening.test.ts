/*
 * Verifies the relevance screening that runs before a full analysis: it judges a
 * whole batch in one call over titles and excerpts only, records what it drops as
 * `SCREENED_OUT`, keeps the batch when the call fails, and leaves unscreened
 * discoveries pending when the screening budget runs out.
 */
// @vitest-environment node
import { createModels, fauxAssistantMessage, fauxProvider, type Api, type Context, type Model } from '@megumi/ai';
import type { TextModelClient } from '@megumi/application/recommendation/call-text-model';
import { createCandidateStorage } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createContentStorage } from '@megumi/application/recommendation/content/content-storage';
import {
  estimateScreeningRequest,
  screenDiscoveries,
  type ScreeningRequestEstimate,
} from '@megumi/application/recommendation/content/screen-discoveries';
import { createSearchStorage } from '@megumi/application/recommendation/discovery/search-storage';
import { executePlannedSearch } from '@megumi/application/recommendation/discovery/execute-searches';
import { createInterestManagement } from '@megumi/application/recommendation/interests/manage-interests';
import { createInterestStorage } from '@megumi/application/recommendation/interests/interest-storage';
import type { SourceConnector } from '@megumi/application/recommendation/sources/source-connector';
import { createExecutionBudget } from '@megumi/application/recommendation/supply/execution-budget';
import {
  runMaintenance,
  type MaintenanceDependencies,
  type MaintenanceRunInput,
} from '@megumi/application/recommendation/supply/run-maintenance';
import type { SupplyExecutionConfig } from '@megumi/application/recommendation/supply/read-supply-config';
import { CandidateSupplyConfigurationSchema } from '@megumi/application/settings/definitions/discovery';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stubDescriptor } from './source-fixture';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1_000;
const EXCERPT = '这是一段与关注无关的短文，用于验证标题与来源文本开头的可见范围。';
const TAIL = 'TAIL_ONLY_IN_THE_FULL_MATERIAL';

describe('relevance screening', () => {
  let database: DatabaseConnection;
  let model: Model<Api>;
  let calls: { system: string; prompt: string }[];
  let client: TextModelClient;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    seedInterest(database, 'i1', 'Rust 异步运行时');
    const faux = fauxProvider({ models: [{ id: 'faux-supply' }] });
    const models = createModels();
    models.setProvider(faux.provider);
    const resolved = models.getModel(faux.provider.id, 'faux-supply');
    if (!resolved) throw new Error('expected the faux model to be registered');
    model = resolved;
    calls = [];
    client = replyWith({ screening: { decisions: [] } });
  });

  afterEach(() => database.close());

  it('records the dropped items of one batch and leaves the kept ones pending', async () => {
    seedResult(database, 'r1', 'https://example.com/a');
    seedResult(database, 'r2', 'https://example.com/b');
    client = replyWith({
      screening: {
        decisions: [
          { itemId: 'r1', verdict: 'drop' },
          { itemId: 'r2', verdict: 'keep' },
        ],
      },
    });

    const outcome = await screenDiscoveries(dependencies(), request());

    expect(outcome).toEqual({
      status: 'screened',
      decisions: [
        { resultId: 'r1', keep: false },
        { resultId: 'r2', keep: true },
      ],
      deferred: false,
    });
    // A dropped discovery is finished work: it is recorded instead of staying pending.
    expect(resultRow(database, 'r1')).toEqual({ status: 'rejected', lastErrorCode: 'SCREENED_OUT' });
    expect(resultRow(database, 'r2')).toEqual({ status: 'pending', lastErrorCode: null });
    // Screening is not analysis: it creates no content.
    expect(countRows(database, 'contents')).toBe(0);
  });

  it('gives the model titles and excerpts only, never the whole material', async () => {
    seedResult(database, 'r1', 'https://example.com/a', {
      text: `${EXCERPT}${'填充'.repeat(300)}${TAIL}`,
      title: '标题一',
    });
    client = replyWith({ screening: { decisions: [{ itemId: 'r1', verdict: 'keep' }] } });

    await screenDiscoveries(dependencies(), request());

    const prompt = calls[0]?.prompt ?? '';
    expect(prompt).toContain('标题一');
    expect(prompt).toContain(EXCERPT);
    // Only the opening travels: the end of a long material never reaches the model.
    expect(prompt).not.toContain(TAIL);
    // Enabled interests travel as ids with their description, so the model can echo one back.
    expect(prompt).toContain('"interestId":"i1"');
    expect(prompt).toContain('Rust 异步运行时');
    // The system prompt names every output field, or the model invents its own.
    const system = calls[0]?.system ?? '';
    expect(system).toContain('"decisions"');
    expect(system).toContain('"itemId"');
    expect(system).toContain('"verdict"');
  });

  it('keeps an item the model left undecided instead of dropping it', async () => {
    seedResult(database, 'r1', 'https://example.com/a');
    client = replyWith({ screening: { decisions: [{ itemId: 'not-a-discovery', verdict: 'drop' }] } });

    const outcome = await screenDiscoveries(dependencies(), request());

    expect(outcome.status).toBe('screened');
    if (outcome.status !== 'screened') throw new Error('expected a screened batch');
    expect(outcome.decisions).toEqual([{ resultId: 'r1', keep: true }]);
    expect(resultRow(database, 'r1')).toEqual({ status: 'pending', lastErrorCode: null });
  });

  it('keeps a rediscovery of stored content out of screening entirely', async () => {
    database
      .prepare({
        sql: `INSERT INTO contents (id, source, canonical_url, text, created_at, updated_at)
              VALUES ('c1','zhihu','https://example.com/a','已保存材料',0,0)`,
      })
      .run();
    seedResult(database, 'r1', 'https://example.com/a');
    client = replyWith({ screeningFailure: true });

    const outcome = await screenDiscoveries(dependencies(), request());

    // Nothing was judged, so no call was made and the stored content is reused later.
    expect(outcome).toEqual({ status: 'screened', decisions: [], deferred: false });
    expect(calls).toEqual([]);
    expect(resultRow(database, 'r1')).toEqual({ status: 'pending', lastErrorCode: null });
  });

  it('keeps the whole batch and reports it when the screening call fails', async () => {
    seedResult(database, 'r1', 'https://example.com/a');
    seedResult(database, 'r2', 'https://example.com/b');
    client = replyWith({ screeningFailure: true });

    const outcome = await screenDiscoveries(dependencies(), request());

    expect(outcome).toMatchObject({ status: 'failed', code: 'INVALID_RESULT' });
    expect(resultRow(database, 'r1')).toEqual({ status: 'pending', lastErrorCode: null });
    expect(resultRow(database, 'r2')).toEqual({ status: 'pending', lastErrorCode: null });
  });

  it('leaves the rest of the batch pending when the screening budget runs out', async () => {
    seedResult(database, 'r1', 'https://example.com/a');
    seedResult(database, 'r2', 'https://example.com/b');
    seedResult(database, 'r3', 'https://example.com/c');
    let reservedCalls = 0;
    client = replyWith({ screening: { decisions: [{ itemId: 'r1', verdict: 'keep' }] } });

    const outcome = await screenDiscoveries(dependencies(), {
      ...request(),
      // The prompt header alone fills one request, so each discovery needs its own call.
      maxInputTokens: 60,
      maxOutputTokens: 10,
      reserveScreening: () => {
        reservedCalls += 1;
        return reservedCalls === 1;
      },
    });

    expect(outcome).toMatchObject({ status: 'screened', deferred: true });
    // Only the one discovery the budget paid for was judged.
    expect(calls).toHaveLength(1);
    expect(reservedCalls).toBe(2);
    for (const id of ['r1', 'r2', 'r3']) {
      expect(resultRow(database, id)).toEqual({ status: 'pending', lastErrorCode: null });
    }
  });

  it('reserves one call with the size the batch will actually cost', async () => {
    seedResult(database, 'r1', 'https://example.com/a');
    const reserved: ScreeningRequestEstimate[] = [];
    client = replyWith({ screening: { decisions: [{ itemId: 'r1', verdict: 'keep' }] } });
    const screening = {
      ...request(),
      reserveScreening: (estimate: ScreeningRequestEstimate) => {
        reserved.push(estimate);
        return true;
      },
    };

    await screenDiscoveries(dependencies(), screening);

    // One item per batch, so the reserved size is exactly what that call costs.
    const expected = estimateScreeningRequest({ ...screening, maxBatchItems: 1 }, [
      {
        discovery: {
          resultId: 'r1',
          item: { source: 'zhihu', url: 'https://example.com/a', title: '标题', text: EXCERPT },
        },
        title: '标题',
        excerpt: EXCERPT,
      },
    ]);
    expect(reserved[0]).toMatchObject({
      inputTokens: expected.inputTokens,
      outputTokens: expected.outputTokens,
    });
    expect(reserved[0]!.inputTokens).toBeGreaterThan(0);
  });

  it('splits a batch that exceeds the batch limit instead of sending it as one call', async () => {
    for (const id of ['r1', 'r2', 'r3']) {
      seedResult(database, id, `https://example.com/${id}`);
    }
    let reservedCalls = 0;
    client = replyWith({ screening: { decisions: [] } });

    const outcome = await screenDiscoveries(dependencies(), {
      ...request(),
      maxBatchItems: 1,
      reserveScreening: () => {
        reservedCalls += 1;
        return true;
      },
    });

    expect(outcome).toMatchObject({ status: 'screened', deferred: false });
    expect(calls).toHaveLength(3);
    expect(reservedCalls).toBe(3);
  });

  it('screens a resume batch that is larger than the source single-search limit', async () => {
    for (let index = 0; index < 25; index += 1) {
      seedResult(database, `r${index}`, `https://example.com/${index}`);
    }

    const outcome = await screenDiscoveries(dependencies(), {
      ...request(),
      maxBatchItems: 10,
      reserveScreening: () => true,
    });

    expect(outcome).toMatchObject({ status: 'screened', deferred: false });
    // Three calls of ten, ten, and five instead of one oversized request.
    expect(calls).toHaveLength(3);
  });

  it('screens a pending discovery before paying for its full analysis', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'pending');
    const tasks: string[] = [];
    client = roundClient(tasks, 'keep');

    const result = await runMaintenance(roundDependencies(), runInput());

    expect(tasks).toEqual(['screen', 'analyze']);
    expect(result.savedCounts).toMatchObject({ normalizedContents: 1, analyzedContents: 1 });
    expect(result.issues).toEqual([]);
    expect(resultRow(database, 'r1')).toEqual({ status: 'normalized', lastErrorCode: null });
  });

  it('drops a pending discovery without creating content or analyzing it', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'pending');
    const tasks: string[] = [];
    client = roundClient(tasks, 'drop');

    const result = await runMaintenance(roundDependencies(), runInput());

    expect(tasks).toEqual(['screen']);
    expect(result.savedCounts).toMatchObject({ screenedOutItems: 1, analyzedContents: 0 });
    expect(countRows(database, 'contents')).toBe(0);
    expect(resultRow(database, 'r1')).toEqual({ status: 'rejected', lastErrorCode: 'SCREENED_OUT' });
  });

  it('keeps the batch when the screening call fails instead of dropping discoveries', async () => {
    insertDiscovery(database, 'r1', 'https://example.com/a', 'pending');
    const tasks: string[] = [];
    client = {
      async completeSimple(_model, context) {
        if (isScreening(context.systemPrompt)) {
          tasks.push('screen');
          return fauxAssistantMessage('not json at all');
        }
        if (isPlanning(context.systemPrompt)) return fauxAssistantMessage('{"items":[]}');
        tasks.push('analyze');
        return fauxAssistantMessage(analysisJson());
      },
    };

    const result = await runMaintenance(roundDependencies(), runInput());

    // The full analysis still runs, and the failure is reported rather than silent.
    // The stage stays inside the Spec's fixed set: screening is a material filter.
    expect(tasks).toEqual(['screen', 'analyze']);
    expect(countRows(database, 'contents')).toBe(1);
    expect(result.issues).toEqual([
      {
        stage: 'material',
        code: 'INVALID_RESULT',
        subjectId: 'r1',
        message: expect.stringContaining('Relevance screening failed'),
      },
    ]);
  });

  it('re-screens a discovery an earlier round screened out when a search finds it again', async () => {
    const search = createSearchStorage(database);
    const source = foundSource('https://example.com/a');
    const run = (startedAt: number, suffix: string) =>
      executePlannedSearch(
        {
          database,
          source,
          storage: search,
          budget: createExecutionBudget({
            limits: supplyConfig().limits,
            startedAt,
            now: () => startedAt,
          }),
          newQueryId: () => `query-${suffix}`,
          newResultId: () => `result-${suffix}`,
          newHistoryId: () => `history-${suffix}`,
          // The second search runs well past the reuse window, so it really searches.
          reuseIntervalMs: 60_000,
          cooldownMs: 0,
        },
        {
          interestId: 'i1',
          source: 'zhihu',
          limit: 10,
          query: 'Rust 异步运行时',
          now: startedAt,
        },
      );

    const first = await run(NOW, '1');
    expect(first.status).toBe('success');
    if (first.status !== 'success') throw new Error('expected a stored discovery');
    expect(first.items[0]).toMatchObject({ resultId: 'result-1', created: true });
    markScreenedOut(database, 'result-1');
    expect(search.listDueDiscoveries({ limit: 10, now: NOW, maxAttempts: 3 })).toEqual([]);

    const second = await run(NOW + HOUR, '2');

    // The current interests may have changed, so the exclusion is not permanent.
    expect(second.status).toBe('success');
    if (second.status !== 'success') throw new Error('expected a stored discovery');
    expect(second.items[0]).toMatchObject({ resultId: 'result-1', created: false });
    expect(resultRow(database, 'result-1')).toEqual({ status: 'pending', lastErrorCode: null });
    expect(search.listDueDiscoveries({ limit: 10, now: NOW, maxAttempts: 3 })).toHaveLength(1);
  });

  /** One batch of the shape a single search or one resume batch produces. */
  function request() {
    return {
      items: createSearchStorage(database).listDueDiscoveries({
        limit: 100,
        now: NOW,
        maxAttempts: 3,
      }),
      interests: [{ id: 'i1', text: 'Rust 异步运行时' }],
      model,
      contentLanguages: [] as readonly string[],
      maxInputTokens: 10_000,
      maxOutputTokens: 500,
      // A single search returns at most this many items (Zhihu: 10).
      maxBatchItems: 10,
      now: NOW,
    };
  }

  function dependencies() {
    return { client, contents: createContentStorage(database) };
  }

  function roundDependencies(): MaintenanceDependencies {
    const config = supplyConfig();
    return {
      config,
      database,
      model,
      sources: [unusedSource()],
      client,
      interests: createInterestManagement({
        storage: createInterestStorage(database),
        newInterestId: () => 'generated',
        now: () => NOW,
      }),
      contents: createContentStorage(database),
      candidates: createCandidateStorage(database),
      search: createSearchStorage(database),
      usage: { readUsageSnapshot: async () => ({ revision: 'rev-1', excludedContentIds: [] }) },
      retention: { findRetainedContentIds: async () => [] },
      newId: (prefix: string) => `${prefix}-1`,
      now: () => NOW,
    };
  }

  /** A round client that records the screening and analysis tasks it was asked to run. */
  function roundClient(tasks: string[], verdict: 'keep' | 'drop'): TextModelClient {
    return {
      async completeSimple(_model, context) {
        if (isScreening(context.systemPrompt)) {
          tasks.push('screen');
          return fauxAssistantMessage(JSON.stringify({ decisions: [{ itemId: 'r1', verdict }] }));
        }
        if (isPlanning(context.systemPrompt)) return fauxAssistantMessage('{"items":[]}');
        tasks.push('analyze');
        return fauxAssistantMessage(analysisJson());
      },
    };
  }

  /** A client that answers screening requests from the given script. */
  function replyWith(script: {
    readonly screening?: unknown;
    readonly screeningFailure?: boolean;
  }): TextModelClient {
    return {
      async completeSimple(_model, context) {
        calls.push({ system: context.systemPrompt, prompt: promptOf(context) });
        if (!isScreening(context.systemPrompt)) throw new Error('expected a screening request');
        if (script.screeningFailure) return fauxAssistantMessage('not json at all');
        return fauxAssistantMessage(JSON.stringify(script.screening));
      },
    };
  }
});

function runInput(): MaintenanceRunInput {
  const config = supplyConfig();
  return {
    trigger: 'startup',
    budget: createExecutionBudget({ limits: config.limits, startedAt: NOW, now: () => NOW }),
    signal: new AbortController().signal,
    deliver: async () => undefined,
    pendingRequirements: () => [],
  };
}

/** The screening and analysis system prompts differ in the output fields they name. */
function isScreening(systemPrompt: string): boolean {
  return systemPrompt.includes('"decisions"');
}

function isPlanning(systemPrompt: string): boolean {
  return systemPrompt.startsWith('You plan searches');
}

function unusedSource(): SourceConnector {
  return {
    id: 'zhihu',
    descriptor: stubDescriptor,
    async search() {
      return { status: 'success', items: [] };
    },
    async fetch() {
      return {
        status: 'failed',
        failure: { code: 'material_unavailable', message: 'not used', retryable: false },
      };
    },
  };
}

/** A source that returns the same single item under `url` on every search. */
function foundSource(url: string): SourceConnector {
  return {
    id: 'zhihu',
    descriptor: stubDescriptor,
    async search() {
      return {
        status: 'success',
        items: [{ source: 'zhihu', url, title: '标题', text: EXCERPT, publishedAt: NOW - HOUR }],
      };
    },
    async fetch() {
      return {
        status: 'failed',
        failure: { code: 'material_unavailable', message: 'not used', retryable: false },
      };
    },
  };
}

function supplyConfig(): SupplyExecutionConfig {
  const parsed = CandidateSupplyConfigurationSchema.parse({});
  return {
    daily: parsed.daily,
    longTerm: parsed.longTerm,
    freshnessDays: parsed.freshnessDays,
    maintenanceIntervalMinutes: parsed.maintenanceIntervalMinutes,
    contentLanguages: parsed.contentLanguages,
    searchHistoryDays: parsed.searchHistoryDays,
    searchReuseIntervalMinutes: parsed.searchReuseIntervalMinutes,
    maxSearchBackoffHours: parsed.maxSearchBackoffHours,
    limits: parsed.limits,
  };
}

function analysisJson(): string {
  return JSON.stringify({
    summary: 'Tokio 是 Rust 的异步运行时。',
    keyPoints: [{ text: '提供异步调度', evidence: EXCERPT }],
    topics: ['异步'],
    entities: ['Tokio'],
    contentType: 'article',
    qualityScore: 0.6,
    spamScore: 0.1,
    longTermValue: 'learning',
    matches: [{ interestId: 'i1', relation: 'direct', basis: '直接讨论 Tokio' }],
  });
}

function seedInterest(database: DatabaseConnection, id: string, text: string): void {
  database
    .prepare({
      sql: 'INSERT INTO interests (id, text, enabled, created_at, updated_at) VALUES (?, ?, 1, 0, 0)',
    })
    .run([id, text]);
}

function seedResult(
  database: DatabaseConnection,
  id: string,
  url: string,
  content: { readonly text?: string; readonly title?: string } = {},
): void {
  database
    .prepare({
      sql: `INSERT INTO search_results
              (id, source, url, title, description, published_at, status, attempts, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    })
    .run([id, url, content.title ?? '标题', content.text ?? EXCERPT, NOW - HOUR, NOW, NOW]);
}

function insertDiscovery(
  database: DatabaseConnection,
  id: string,
  url: string,
  status: string,
): void {
  database
    .prepare({
      sql: `INSERT INTO search_results
              (id, source, url, title, description, published_at, status, attempts, first_seen_at, last_seen_at)
            VALUES (?, 'zhihu', ?, '标题', ?, ?, ?, 0, ?, ?)`,
    })
    .run([id, url, EXCERPT, NOW - HOUR, status, NOW, NOW]);
}

function markScreenedOut(database: DatabaseConnection, id: string): void {
  database
    .prepare({
      sql: "UPDATE search_results SET status = 'rejected', last_error_code = 'SCREENED_OUT' WHERE id = ?",
    })
    .run([id]);
}

function resultRow(
  database: DatabaseConnection,
  id: string,
): { status: string; lastErrorCode: string | null } {
  const row = database
    .prepare<{ status: string; last_error_code: string | null }>({
      sql: 'SELECT status, last_error_code FROM search_results WHERE id = ?',
    })
    .get([id]);
  if (!row) throw new Error('expected a stored discovery');
  return { status: row.status, lastErrorCode: row.last_error_code };
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
