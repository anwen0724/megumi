/* Drives the real Agent Loop through daily search, selection and atomic publication. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Models,
} from '@megumi/ai';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDiscoveryAgent,
  createDiscoveryRepository,
  createSourceRegistry,
  type CreateDiscoveryAgentOptions,
  type DiscoverySource,
  type SourceContent,
} from '@megumi/discovery-agent';
import { createEventBus } from '@megumi/events';

const now = '2026-08-22T10:00:00.000Z';
const model = {
  id: 'daily-model', name: 'Daily Model', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 16_384, maxTokens: 2_048,
} as Model<Api>;

describe('daily discovery Agent execution', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });
  afterEach(() => database.close());

  it('closes the durable two-day discovery loop and applies feedback only to the next execution', async () => {
    let searchNumber = 0;
    const contexts: Context[] = [];
    const community = source('community', async () => {
      searchNumber += 1;
      const item = (id: string, title: string): SourceContent => ({
        ...content(id, title), sourceId: 'community', sourceName: 'Community',
      });
      return searchNumber === 1
        ? [item('shared', 'First-day Agent article')]
        : [item('shared', 'First-day Agent article'), item('new', 'Second-day Agent article')];
    });
    const fixture = createFixture(database, [community], [
      toolStream('day1:search', 'search_content', { sourceId: 'community', query: 'Agent', mode: 'relevance', limit: 5 }),
      toolStream('day1:select', 'select_recommendations', { items: [{ candidateId: 'candidate:1', recommendationReason: 'Day one reason.' }] }),
      textStream('done'),
      toolStream('day2:search', 'search_content', { sourceId: 'community', query: 'Agent new', mode: 'relevance', limit: 5 }),
      toolStream('day2:select', 'select_recommendations', { items: [{ candidateId: 'candidate:1', recommendationReason: 'Day two reason.' }] }),
      textStream('done'),
    ], contexts, 10);
    addInterest(fixture.repository, 'interest:1', 'Agent engineering');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'published');
    const firstDayBeforeFeedback = fixture.repository.readHome({
      mode: 'timeline', localDate: '2026-08-22', limit: 20,
    }).days[0]!.recommendations[0]!;
    fixture.repository.updateRecommendationState({
      recommendationId: firstDayBeforeFeedback.recommendationId,
      action: 'set_reaction', reaction: 'disliked', now,
    });

    const secondDay = '2026-08-23T10:00:00.000Z';
    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now: secondDay });
    await waitForBatch(database, 'published', '2026-08-23');

    expect(contexts[3]?.systemPrompt).toContain('First-day Agent article');
    expect(contexts[3]?.systemPrompt).toContain('"reaction":"disliked"');
    const restartedRepository = createDiscoveryRepository({ database });
    const restartedHome = restartedRepository.readHome({
      mode: 'timeline', localDate: '2026-08-23', limit: 20,
    });
    expect(restartedHome.days.map((day) => [day.localDate, day.recommendations.map((item) => item.title)]))
      .toEqual([
        ['2026-08-23', ['Second-day Agent article']],
        ['2026-08-22', ['First-day Agent article']],
      ]);
    expect(restartedHome.days[1]!.recommendations[0]).toMatchObject({
      recommendationReason: 'Day one reason.', reaction: 'disliked',
    });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_batches',
    }).get()?.count).toBe(2);
    await expect(fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now: secondDay }))
      .resolves.toMatchObject({ status: 'already_published', localDate: '2026-08-23' });
  });

  it('lets the Agent adjust queries and sources, then publishes only its explicit selection', async () => {
    const calls: Array<{ sourceId: string; query: string }> = [];
    const openWeb = source('open_web', async (query) => {
      calls.push({ sourceId: 'open_web', query });
      if (query === 'Agent engineering') return [content('article:agent', 'Agent engineering deep dive')];
      return [];
    });
    const bilibili = source('bilibili', async (query) => {
      calls.push({ sourceId: 'bilibili', query });
      return { status: 'failed', failure: { code: 'risk_control', message: 'cooldown', retryable: true } };
    }, ['relevance', 'recent']);
    const streams = [
      toolStream('call:1', 'search_content', { sourceId: 'open_web', query: 'Agent engineering', mode: 'relevance', limit: 5 }),
      toolStream('call:2', 'search_content', { sourceId: 'open_web', query: 'graduate recruitment 2027', mode: 'relevance', limit: 5 }),
      toolStream('call:3', 'search_content', { sourceId: 'bilibili', query: '秋招经验', mode: 'recent', limit: 5 }),
      toolStream('call:4', 'select_recommendations', {
        items: [{ candidateId: 'candidate:1', recommendationReason: '包含可落地的工程实践。' }],
      }),
      textStream('最终文本里提到其他链接也不能成为推荐。'),
    ];
    const contexts: Context[] = [];
    const fixture = createFixture(database, [openWeb, bilibili], streams, contexts, 5);
    addInterest(fixture.repository, 'interest:1', 'Agent 工程化与真实项目');
    addInterest(fixture.repository, 'interest:2', '2027 届秋招信息');

    const started = await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    expect(started).toMatchObject({ status: 'started', localDate: '2026-08-22' });
    await waitForBatch(database, 'published');

    expect(calls).toEqual([
      { sourceId: 'open_web', query: 'Agent engineering' },
      { sourceId: 'open_web', query: 'graduate recruitment 2027' },
      { sourceId: 'bilibili', query: '秋招经验' },
    ]);
    expect(contexts[0].systemPrompt).toContain('Agent 工程化与真实项目');
    expect(contexts[0].systemPrompt).toContain('2027 届秋招信息');
    expect(contexts[0].systemPrompt).toContain('open_web');
    expect(readRecommendations(database)).toEqual([expect.objectContaining({
      title: 'Agent engineering deep dive',
      recommendation_reason: '包含可落地的工程实践。',
      position: 0,
    })]);
    expect(readBatch(database)).toMatchObject({ status: 'published', result_count: 1, target_count: 5 });
  });

  it('freezes the first valid selection and does not let later Tool calls replace it', async () => {
    const search = vi.fn(async () => [
      content('one', 'First'),
      content('two', 'Second'),
    ]);
    const adapter = source('open_web', search);
    const streams = [
      toolStream('call:1', 'search_content', { sourceId: 'open_web', query: 'query', mode: 'relevance', limit: 5 }),
      toolStream('call:2', 'select_recommendations', {
        items: [{ candidateId: 'candidate:1', recommendationReason: 'First reason' }],
      }),
      toolStream('call:3', 'search_content', { sourceId: 'open_web', query: 'must not run', mode: 'relevance', limit: 5 }),
      toolStream('call:4', 'select_recommendations', {
        items: [{ candidateId: 'candidate:2', recommendationReason: 'Replacement' }],
      }),
      textStream('done'),
    ];
    const fixture = createFixture(database, [adapter], streams);
    addInterest(fixture.repository, 'interest:1', 'Anything useful');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'published');

    expect(search).toHaveBeenCalledTimes(1);
    expect(readRecommendations(database).map((row) => row.title)).toEqual(['First']);
  });

  it('stops invoking sources after the 12-search budget is exhausted', async () => {
    let itemNumber = 0;
    const search = vi.fn(async () => [content(`item:${++itemNumber}`, `Item ${itemNumber}`)]);
    const adapter = source('open_web', search);
    const streams = [
      toolsStream(Array.from({ length: 13 }, (_, index) => ({
        id: `search:${index}`,
        name: 'search_content',
        arguments: { sourceId: 'open_web', query: `query ${index}`, mode: 'relevance', limit: 1 },
      }))),
      toolStream('select:1', 'select_recommendations', {
        items: [{ candidateId: 'candidate:1', recommendationReason: 'Within search budget' }],
      }),
      textStream('done'),
    ];
    const fixture = createFixture(database, [adapter], streams);
    addInterest(fixture.repository, 'interest:1', 'Broad topic');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'published');

    expect(search).toHaveBeenCalledTimes(12);
  });

  it('enforces candidate and read budgets inside Tool execution', async () => {
    const read = vi.fn(async ({ url }: { url: string }) => ({
      status: 'success' as const,
      detail: { ...content(url.split('/').at(-1)!, 'Detail'), contentText: 'full content' },
    }));
    let searchNumber = 0;
    const search = vi.fn(async () => Array.from({ length: 20 }, (_, index) => (
      content(`${searchNumber}:${index}`, `Candidate ${searchNumber}:${index}`)
    )).map((item) => item));
    const adapter: DiscoverySource = {
      ...source('open_web', async () => {
        searchNumber += 1;
        return search();
      }),
      read,
    };
    const searchCalls = Array.from({ length: 13 }, (_, index) => ({
      id: `search:${index}`,
      name: 'search_content',
      arguments: { sourceId: 'open_web', query: `query ${index}`, mode: 'relevance', limit: 20 },
    }));
    const readCalls = Array.from({ length: 41 }, (_, index) => ({
      id: `read:${index}`,
      name: 'read_candidate',
      arguments: { candidateId: 'candidate:1' },
    }));
    const streams = [
      toolsStream(searchCalls),
      toolsStream(readCalls),
      toolStream('select:1', 'select_recommendations', {
        items: [{ candidateId: 'candidate:1', recommendationReason: 'Within fixed budgets' }],
      }),
      textStream('done'),
    ];
    const fixture = createFixture(database, [adapter], streams);
    addInterest(fixture.repository, 'interest:1', 'Broad topic');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'published');

    expect(search).toHaveBeenCalledTimes(10);
    expect(read).toHaveBeenCalledTimes(40);
    expect(readRecommendations(database)).toHaveLength(1);
  });

  it.each([
    {
      streams: [
        textStream('No tool selection'),
        textStream('No tool selection'),
        textStream('No tool selection'),
      ],
      expected: 'selection_missing',
    },
    {
      streams: [
        toolStream('call:1', 'select_recommendations', {
          items: [{ candidateId: 'missing', recommendationReason: 'invalid' }],
        }),
        textStream('done'),
        toolStream('call:2', 'select_recommendations', {
          items: [{ candidateId: 'missing', recommendationReason: 'invalid' }],
        }),
        textStream('done'),
        toolStream('call:3', 'select_recommendations', {
          items: [{ candidateId: 'missing', recommendationReason: 'invalid' }],
        }),
        textStream('done'),
      ],
      expected: 'selection_invalid',
    },
  ])('does not publish partial data when execution ends with $expected', async ({ streams, expected }) => {
    const fixture = createFixture(database, [source('open_web', async () => [])], streams);
    addInterest(fixture.repository, 'interest:1', 'Agent');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'failed');

    expect(readBatch(database)).toMatchObject({ status: 'failed', failure_code: expected });
    expect(readRecommendations(database)).toEqual([]);
  });

  it('does not automatically retry a non-retryable source failure and preserves source diagnostics', async () => {
    const unavailable = source('open_web', async () => ({
      status: 'failed',
      failure: { code: 'not_configured', message: 'Open Web search is not configured.', retryable: false },
    }));
    const fixture = createFixture(database, [unavailable], [
      toolStream('call:1', 'search_content', {
        sourceId: 'open_web', query: 'Agent', mode: 'relevance', limit: 5,
      }),
      textStream('No available source.'),
    ]);
    addInterest(fixture.repository, 'interest:1', 'Agent');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'failed');

    expect(readBatch(database)).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      automatic_retry_count: 0,
      failure_code: 'source_search_failed',
      failure_message: expect.stringMatching(/open_web.*not_configured/i),
    });
  });

  it('rejects content identities that have already been published globally', async () => {
    seedPublishedRecommendation(database, 'open_web:id:seen');
    const adapter = source('open_web', async () => [
      content('seen', 'Seen before'),
      content('new', 'Never seen'),
    ]);
    const fixture = createFixture(database, [adapter], [
      toolStream('call:1', 'search_content', { sourceId: 'open_web', query: 'agent', mode: 'relevance', limit: 5 }),
      toolStream('call:2', 'select_recommendations', {
        items: [{ candidateId: 'candidate:1', recommendationReason: 'New identity' }],
      }),
      textStream('done'),
    ]);
    addInterest(fixture.repository, 'interest:1', 'Agent');

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now });
    await waitForBatch(database, 'published', '2026-08-22');

    expect(readRecommendations(database).map((row) => row.title)).toEqual(['Old', 'Never seen']);
  });
});

function createFixture(
  database: DatabaseConnection,
  sources: readonly DiscoverySource[],
  streams: AssistantMessageEventStream[],
  contexts: Context[] = [],
  targetCount = 20,
) {
  const repository = createDiscoveryRepository({ database });
  let executionNumber = 0;
  let batchNumber = 0;
  let recommendationNumber = 0;
  let interestNumber = 0;
  const models = {
    streamSimple: vi.fn((_model: Model<Api>, context: Context) => {
      contexts.push(context);
      const stream = streams.shift();
      if (!stream) throw new Error('Unexpected model call.');
      return stream;
    }),
  } as unknown as Models;
  const options: CreateDiscoveryAgentOptions = {
    ids: {
      createExecutionId: () => `execution:${++executionNumber}`,
      createSessionMessageId: () => 'message:unused',
      createModelCallId: () => 'model-call:unused',
      createToolExecutionId: () => 'tool:unused',
      createApprovalId: () => 'approval:unused',
    },
    clock: { now: () => now },
    terminalRetentionMs: 60_000,
    events: createEventBus(), models,
    context: {} as never, tools: {} as never, permissions: {} as never, session: {} as never,
    conversation: {
      input: {} as never, sessions: {} as never, history: {} as never, branches: {} as never,
      resolveModel: async () => ({ status: 'ok', model }),
    },
    interests: {
      repository,
      settings: { getDiscoverySettings: () => ({ conversationRecognitionEnabled: false }) },
      sessions: {} as never, history: {} as never,
      resolveModel: async () => ({ status: 'ok', model }),
      extractor: async () => ({ evidence: [] }),
      ids: {
        createInterestId: () => `interest:${++interestNumber}`,
        createEvidenceId: () => 'evidence:unused',
      },
      clock: { now: () => now },
    },
    dailyDiscovery: {
      repository,
      sourceRegistry: createSourceRegistry(sources),
      settings: { getDiscoverySettings: () => ({
        dailyGenerationTime: '08:00',
        dailyTargetCount: targetCount,
        enabledSources: sources.map((source) => source.descriptor.id),
      }) },
      timezone: () => 'Asia/Shanghai',
      resolveModel: async () => model,
      ids: {
        createBatchId: () => `batch:${++batchNumber}`,
        createRecommendationId: () => `recommendation:${++recommendationNumber}`,
      },
    },
    policy: {
      maxModelCallsPerExecution: 4, maxToolRoundsPerExecution: 3,
      maxToolCallsPerModelCall: 4, maxToolCallsPerExecution: 8,
      maxConcurrentToolExecutions: 2, modelCallTimeoutMs: 1_000,
      toolExecutionTimeoutMs: 1_000, maxModelCallAttempts: 1,
      modelRetryDelayMs: 0, maxContextOverflowRecoveries: 1,
      providerRequestMaxRetries: 0, providerRequestMaxRetryDelayMs: 0,
    },
  };
  return { agent: createDiscoveryAgent(options), repository };
}

function source(
  id: string,
  search: (query: string) => Promise<readonly SourceContent[] | Awaited<ReturnType<DiscoverySource['search']>>>,
  modes: Array<'relevance' | 'recent'> = ['relevance'],
): DiscoverySource {
  return {
    descriptor: { id, name: id, supportedModes: modes },
    async search(request) {
      const result = await search(request.query);
      return Array.isArray(result) ? { status: 'success', items: result } : result as Awaited<ReturnType<DiscoverySource['search']>>;
    },
  };
}

function content(id: string, title: string): SourceContent {
  return {
    sourceId: 'open_web', sourceName: 'example.com', sourceContentId: id,
    canonicalUrl: `https://example.com/${id}`, contentType: 'article', title,
    description: `${title} description`,
  };
}

function toolStream(id: string, name: string, argumentsValue: unknown) {
  return toolsStream([{ id, name, arguments: argumentsValue }]);
}

function toolsStream(calls: Array<{ id: string; name: string; arguments: unknown }>): AssistantMessageEventStream {
  const message = assistant([
    ...calls.map((call) => ({
      type: 'toolCall' as const, id: call.id, name: call.name,
      arguments: call.arguments as Record<string, unknown>,
    })),
  ], 'toolUse');
  return completedStream(message);
}

function textStream(text: string): AssistantMessageEventStream {
  return completedStream(assistant([{ type: 'text', text }], 'stop'));
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === 'toolCall') {
      stream.push({ type: 'toolcall_start', contentIndex, partial: message });
      stream.push({ type: 'toolcall_end', contentIndex, toolCall: block, partial: message });
    } else if (block.type === 'text') {
      stream.push({ type: 'text_start', contentIndex, partial: message });
      stream.push({ type: 'text_delta', contentIndex, delta: block.text, partial: message });
      stream.push({ type: 'text_end', contentIndex, content: block.text, partial: message });
    }
  }
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  stream.end();
  return stream;
}

function assistant(contentValue: AssistantMessage['content'], stopReason: 'stop' | 'toolUse'): AssistantMessage {
  return {
    role: 'assistant', content: contentValue, api: model.api, provider: model.provider,
    model: model.id, stopReason, timestamp: Date.parse(now),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

async function waitForBatch(database: DatabaseConnection, status: 'published' | 'failed', localDate = '2026-08-22') {
  await vi.waitFor(() => expect(readBatch(database, localDate)?.status).toBe(status), { timeout: 2_000 });
}

function readBatch(database: DatabaseConnection, localDate = '2026-08-22') {
  return database.prepare<any>({ sql: 'SELECT * FROM discovery_batches WHERE local_date = ?' }).get([localDate]);
}

function readRecommendations(database: DatabaseConnection) {
  return database.prepare<any>({ sql: 'SELECT * FROM discovery_recommendations ORDER BY published_at, position' }).all();
}

function seedPublishedRecommendation(database: DatabaseConnection, identity: string) {
  database.prepare({ sql: `
    INSERT INTO discovery_batches (
      batch_id, local_date, timezone, status, execution_id, target_count,
      attempt_count, automatic_retry_count, result_count, created_at, updated_at, started_at, published_at
    ) VALUES ('old-batch', '2026-08-21', 'Asia/Shanghai', 'published', 'old-execution', 1, 1, 0, 1, ?, ?, ?, ?)
  ` }).run([now, now, now, now]);
  database.prepare({ sql: `
    INSERT INTO discovery_recommendations (
      recommendation_id, batch_id, content_identity, position, source_id, source_name,
      canonical_url, title, content_type, recommendation_reason, published_at
    ) VALUES ('old-recommendation', 'old-batch', ?, 0, 'open_web', 'example.com',
      'https://example.com/seen', 'Old', 'article', 'Old reason', ?)
  ` }).run([identity, now]);
}

function addInterest(
  repository: ReturnType<typeof createDiscoveryRepository>,
  interestId: string,
  description: string,
) {
  repository.changeInterest({ action: 'create', interestId, description, now });
}
