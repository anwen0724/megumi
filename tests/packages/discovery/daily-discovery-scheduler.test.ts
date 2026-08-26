/* Verifies local scheduling, explicit generation, idempotency, retry and startup recovery. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDailyDiscoveryTestTools } from './daily-discovery-test-tools';
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
  createDiscovery,
  createDiscoveryRepository,
  createSourceRegistry,
  type DiscoverySource,
} from '@megumi/discovery';
import { createAgentExecutions, launchAgentExecution } from '@megumi/execution';
import { createEventBus } from '@megumi/events';
import type { Observability } from '@megumi/observability';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';

const model = {
  id: 'daily-model', name: 'Daily', api: 'test-api', provider: 'test-provider',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192, maxTokens: 1_024,
} as Model<Api>;

describe('daily discovery scheduler and retry lifecycle', () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
  });
  afterEach(() => database.close());

  it('waits until local generation time and schedules only one batch for that day', async () => {
    let now = '2026-08-22T07:59:00.000+08:00';
    const streams = successfulStreams();
    const timers = fakeTimers();
    const fixture = createFixture(database, () => now, streams, timers);
    addInterest(fixture.repository);

    await fixture.agent.startBackground();
    expect(fixture.repository.getDailyBatch('2026-08-22')).toBeUndefined();
    expect(timers.pending()).toHaveLength(1);
    expect(timers.pending()[0].delayMs).toBe(60_000);

    now = '2026-08-22T08:00:00.000+08:00';
    timers.fireNext();
    await waitForStatus(fixture.repository, 'published');
    expect(fixture.repository.getDailyBatch('2026-08-22')).toMatchObject({ attemptCount: 1 });
    expect((await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now })).status).toBe('already_published');
  });

  it('saves the first Interest without generating until an explicit trigger arrives', async () => {
    const streams = successfulStreams();
    const fixture = createFixture(database, () => '2026-08-22T10:00:00.000+08:00', streams);

    await fixture.agent.changeInterest({ action: 'create', description: 'Agent' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.repository.getDailyBatch('2026-08-22')).toBeUndefined();

    const [left, right] = await Promise.all([
      fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now: '2026-08-22T10:00:00.000+08:00' }),
      fixture.agent.ensureDailyDiscovery({ trigger: 'schedule', now: '2026-08-22T10:00:00.000+08:00' }),
    ]);

    expect([left.status, right.status]).toEqual(expect.arrayContaining(['in_progress']));
    await waitForStatus(fixture.repository, 'published');
    expect(database.prepare<{ count: number }>({ sql: 'SELECT COUNT(*) AS count FROM discovery_batches' }).get()?.count).toBe(1);
  });

  it('reuses one batch with new execution IDs for two automatic retries, then permits manual retry', async () => {
    const streams = [textStream('no selection'), textStream('no selection'), textStream('no selection')];
    const fixture = createFixture(database, () => '2026-08-22T10:00:00.000+08:00', streams);
    addInterest(fixture.repository);

    const initial = await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now: '2026-08-22T10:00:00.000+08:00' });
    await waitForStatus(fixture.repository, 'failed');
    const failed = fixture.repository.getDailyBatch('2026-08-22')!;
    expect(failed).toMatchObject({
      batchId: initial.status === 'started' ? initial.batchId : undefined,
      attemptCount: 3,
      automaticRetryCount: 2,
      failureCode: 'selection_missing',
    });
    expect(failed.executionId).not.toBe(initial.status === 'started' ? initial.executionId : undefined);

    streams.push(...successfulStreams());
    const retried = await fixture.agent.ensureDailyDiscovery({ trigger: 'retry', now: '2026-08-22T10:05:00.000+08:00' });
    expect(retried).toMatchObject({ status: 'started', batchId: failed.batchId });
    await waitForStatus(fixture.repository, 'published');
    expect(fixture.repository.getDailyBatch('2026-08-22')).toMatchObject({
      batchId: failed.batchId, attemptCount: 4, automaticRetryCount: 2,
    });

    await fixture.agent.shutdown();
    const traces = fixture.traceRecords.filter((record) => record.type === 'trace.started');
    const attempts = fixture.traceRecords.filter((record) => (
      record.type === 'span.started' && record.name === 'discovery.attempt'
    ));
    expect(traces).toHaveLength(2);
    const automaticAttempts = attempts.filter((record) => record.traceId === traces[0]?.traceId);
    expect(automaticAttempts).toHaveLength(3);
    expect(new Set(automaticAttempts.map((record) => record.parentSpanId)).size).toBe(1);
    expect(attempts.filter((record) => record.traceId === traces[1]?.traceId)).toHaveLength(1);
    expect(fixture.traceRecords.filter((record) => (
      record.type === 'span.event'
      && record.traceId === traces[0]?.traceId
      && record.event.type === 'discovery.retry.scheduled'
    ))).toHaveLength(2);
    expect(fixture.traceRecords).toContainEqual(expect.objectContaining({
      type: 'trace.linked',
      traceId: traces[1]?.traceId,
      targetTraceId: traces[0]?.traceId,
      linkKind: 'retries',
    }));
  });

  it('keeps one Trace open through source normalization, selection and durable publication', async () => {
    const fixture = createFixture(
      database,
      () => '2026-08-22T10:00:00.000+08:00',
      successfulStreams(),
    );
    addInterest(fixture.repository);

    const started = await fixture.agent.ensureDailyDiscovery({
      trigger: 'manual',
      now: '2026-08-22T10:00:00.000+08:00',
    });

    expect(started.status).toBe('started');
    expect(fixture.traceRecords.some((record) => record.type === 'trace.ended')).toBe(false);
    await waitForStatus(fixture.repository, 'published');
    await fixture.agent.shutdown();

    expect(fixture.traceRecords.filter((record) => record.type === 'trace.ended')).toHaveLength(1);
    const spanNames = fixture.traceRecords.flatMap((record) => (
      record.type === 'span.started' ? [record.name] : []
    ));
    expect(spanNames).toEqual(expect.arrayContaining([
      'discovery.preflight',
      'source.availability.check',
      'model.resolve',
      'discovery.attempt',
      'discovery.batch.claim',
      'agent.execution',
      'source.search',
      'discovery.selection',
      'discovery.attempt.settle',
      'recommendation.publish',
    ]));
    const contentKinds = fixture.traceRecords.flatMap((record) => (
      record.type === 'content.recorded' ? [record.kind] : []
    ));
    expect(contentKinds).toEqual(expect.arrayContaining([
      'discovery.material',
      'source.request',
      'source.provider_response',
      'source.result',
      'discovery.candidates',
      'discovery.selection',
      'discovery.recommendations',
    ]));
    expect(contentKinds).not.toContain('recommendation.published');
  });

  it('publishes exactly once when every Observability operation throws', async () => {
    const fixture = createFixture(
      database,
      () => '2026-08-22T10:00:00.000+08:00',
      successfulStreams(),
      undefined,
      {
        onBackgroundError: () => undefined,
        getDiscoverySettings: () => ({
          dailyGenerationTime: '08:00',
          dailyTargetCount: 20,
          enabledSources: ['open_web'],
        }),
        observability: throwingObservability(),
      },
    );
    addInterest(fixture.repository);

    await expect(fixture.agent.ensureDailyDiscovery({
      trigger: 'manual',
      now: '2026-08-22T10:00:00.000+08:00',
    })).resolves.toMatchObject({ status: 'started' });
    await waitForStatus(fixture.repository, 'published');

    expect(fixture.repository.getDailyBatch('2026-08-22')).toMatchObject({
      status: 'published',
      attemptCount: 1,
      resultCount: 1,
    });
  });

  it.each([
    {
      expected: 'no_active_interests',
      addActiveInterest: false,
      enabledSources: ['open_web'] as const,
      resolveModel: async () => model,
    },
    {
      expected: 'no_available_sources',
      addActiveInterest: true,
      enabledSources: [] as const,
      resolveModel: async () => model,
    },
    {
      expected: 'model_unavailable',
      addActiveInterest: true,
      enabledSources: ['open_web'] as const,
      resolveModel: async () => undefined,
    },
  ])('ends $expected as an ok short Trace', async ({
    expected,
    addActiveInterest,
    enabledSources,
    resolveModel,
  }) => {
    const fixture = createFixture(
      database,
      () => '2026-08-22T10:00:00.000+08:00',
      [],
      undefined,
      {
        onBackgroundError: () => undefined,
        getDiscoverySettings: () => ({
          dailyGenerationTime: '08:00',
          dailyTargetCount: 20,
          enabledSources,
        }),
        resolveModel,
      },
    );
    if (addActiveInterest) addInterest(fixture.repository);

    await expect(fixture.agent.ensureDailyDiscovery({
      trigger: 'manual',
      now: '2026-08-22T10:00:00.000+08:00',
    })).resolves.toMatchObject({ status: expected });
    await fixture.agent.shutdown();

    expect(fixture.traceRecords.find((record) => record.type === 'trace.ended'))
      .toMatchObject({ outcome: { status: 'ok', code: expected } });
  });

  it('records in-progress and already-published calls as independent ok short Traces', async () => {
    const fixture = createFixture(
      database,
      () => '2026-08-22T10:00:00.000+08:00',
      successfulStreams(),
    );
    addInterest(fixture.repository);

    await fixture.agent.ensureDailyDiscovery({ trigger: 'manual', now: '2026-08-22T10:00:00.000+08:00' });
    await expect(fixture.agent.ensureDailyDiscovery({
      trigger: 'manual', now: '2026-08-22T10:00:01.000+08:00',
    })).resolves.toMatchObject({ status: 'in_progress' });
    await waitForStatus(fixture.repository, 'published');
    await expect(fixture.agent.ensureDailyDiscovery({
      trigger: 'manual', now: '2026-08-22T10:00:02.000+08:00',
    })).resolves.toMatchObject({ status: 'already_published' });
    await fixture.agent.shutdown();

    const outcomeCodes = fixture.traceRecords.flatMap((record) => (
      record.type === 'trace.ended' && record.outcome.status === 'ok'
        ? [record.outcome.code]
        : []
    ));
    expect(outcomeCodes).toEqual(expect.arrayContaining(['published', 'in_progress', 'already_published']));
  });

  it('marks a legacy running attempt interrupted and resumes it with a fresh execution', async () => {
    const fixture = createFixture(
      database,
      () => '2026-08-22T10:00:00.000+08:00',
      successfulStreams(),
    );
    addInterest(fixture.repository);
    fixture.repository.claimDailyBatch({
      batchId: 'batch:legacy', localDate: '2026-08-22', timezone: 'Asia/Shanghai',
      executionId: 'execution:legacy', targetCount: 20,
      now: '2026-08-22T09:00:00.000+08:00',
    });

    await fixture.agent.startBackground();
    await waitForStatus(fixture.repository, 'published');

    expect(fixture.repository.getDailyBatch('2026-08-22')).toMatchObject({
      batchId: 'batch:legacy', attemptCount: 2, automaticRetryCount: 1,
    });
    expect(fixture.repository.getDailyBatch('2026-08-22')?.executionId).not.toBe('execution:legacy');
    expect(fixture.traceRecords).toContainEqual(expect.objectContaining({
      type: 'trace.linked',
      linkKind: 'continues',
      targetTraceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    }));
  });

  it('cancels the timer during shutdown and does not start scheduled work afterward', async () => {
    const timers = fakeTimers();
    const fixture = createFixture(
      database,
      () => '2026-08-22T07:00:00.000+08:00',
      successfulStreams(),
      timers,
    );
    addInterest(fixture.repository);
    await fixture.agent.startBackground();

    const discoveryShutdown = fixture.agent.shutdown();
    expect(await fixture.executions.shutdown({ timeoutMs: 100 })).toEqual({ status: 'shut_down' });
    await discoveryShutdown;
    expect(timers.pending()).toEqual([]);
    expect(fixture.repository.getDailyBatch('2026-08-22')).toBeUndefined();
  });

  it('observes a scheduled failure once and still schedules the next day', async () => {
    const timers = fakeTimers();
    const failures: unknown[] = [];
    let settingsReads = 0;
    const fixture = createFixture(
      database,
      () => '2026-08-22T07:00:00.000+08:00',
      successfulStreams(),
      timers,
      {
        onBackgroundError: (error) => { failures.push(error); },
        getDiscoverySettings() {
          settingsReads += 1;
          if (settingsReads === 3) throw new Error('Discovery settings are unavailable.');
          return {
            dailyGenerationTime: '08:00',
            dailyTargetCount: 20,
            enabledSources: ['open_web'] as const,
          };
        },
      },
    );
    addInterest(fixture.repository);
    await fixture.agent.startBackground();

    timers.fireNext();

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures[0]).toEqual(expect.objectContaining({ message: 'Discovery settings are unavailable.' }));
    expect(timers.pending()).toHaveLength(1);
  });
});

function createFixture(
  database: DatabaseConnection,
  now: () => string,
  streams: AssistantMessageEventStream[],
  timers?: ReturnType<typeof fakeTimers>,
  background?: {
    readonly onBackgroundError: (error: unknown) => void;
    readonly getDiscoverySettings: () => {
      readonly dailyGenerationTime: string;
      readonly dailyTargetCount: number;
      readonly enabledSources: readonly string[];
    };
    readonly observability?: Observability;
    readonly resolveModel?: () => Promise<Model<Api> | undefined>;
  },
) {
  const repository = createDiscoveryRepository({ database });
  const traceRecords: TraceJournalRecord[] = [];
  const observability = background?.observability ?? recorder(traceRecords);
  let executionNumber = 0;
  let recommendationNumber = 0;
  let batchNumber = 0;
  let interestNumber = 0;
  const source: DiscoverySource = {
    descriptor: {
      id: 'open_web', name: 'Open Web', access: 'configured_provider',
      supportedModes: ['relevance'], supportsRead: false,
    },
    getAvailability: () => ({ state: 'ready' }),
    async search(request) {
      request.onProviderResponse?.({ items: [{ id: 'item:new', title: 'Useful item' }] });
      return { status: 'success', items: [{
        sourceId: 'open_web', sourceName: 'example.com', sourceContentId: 'item:new',
        canonicalUrl: 'https://example.com/item', contentType: 'article', title: 'Useful item',
      }] };
    },
  };
  const models = {
    streamSimple: vi.fn((_model: Model<Api>, _context: Context) => {
      const stream = streams.shift();
      if (!stream) throw new Error('Unexpected model call.');
      return stream;
    }),
  } as unknown as Models;
  const discoveryTools = createDailyDiscoveryTestTools(observability);
  const options = {
    ids: {
      createExecutionId: () => `execution:${++executionNumber}`,
      createSessionMessageId: () => 'message:unused', createModelCallId: () => 'model-call:unused',
      createToolExecutionId: () => 'tool:unused', createApprovalId: () => 'approval:unused',
    },
    clock: { now }, terminalRetentionMs: 60_000, events: createEventBus(), models, observability,
    context: {
      build: async (request) => ({
        status: 'ready' as const,
        prompt: {
          systemPrompt: JSON.stringify(request.modelCallContext.run),
          messages: [...request.currentMessages],
          tools: [...request.modelCallContext.tools],
        },
      }),
      compact: async () => ({ status: 'nothing_to_compact' as const, reason: 'no_historical_messages' as const }),
    },
    tools: discoveryTools.tools, permissions: {} as never, session: {} as never,
    conversation: {
      input: {} as never, sessions: {} as never, history: {} as never, branches: {} as never,
      resolveModel: async () => ({ status: 'ok', model }),
    },
    interests: {
      repository,
      settings: { getDiscoverySettings: () => ({ conversationRecognitionEnabled: false }) },
      sessions: {} as never, history: {} as never,
      resolveModel: async () => ({ status: 'ok', model }), extractor: async () => ({ evidence: [] }),
      ids: { createInterestId: () => `interest:${++interestNumber}`, createEvidenceId: () => 'evidence:unused' },
      clock: { now },
    },
    dailyDiscovery: {
      repository,
      attempts: discoveryTools.attempts,
      sourceRegistry: createSourceRegistry([source], { observability }),
      observability,
      settings: { getDiscoverySettings: background?.getDiscoverySettings ?? (() => ({
        dailyGenerationTime: '08:00', dailyTargetCount: 20, enabledSources: ['open_web'],
      })) },
      onBackgroundError: background?.onBackgroundError ?? (() => undefined),
      timezone: () => 'Asia/Shanghai', resolveModel: background?.resolveModel ?? (async () => model),
      ids: {
        createBatchId: () => `batch:${++batchNumber}`,
        createRecommendationId: () => `recommendation:${++recommendationNumber}`,
      },
      ...(timers ? { timers } : {}),
    },
    policy: {
      maxModelCallsPerExecution: 80, maxToolRoundsPerExecution: 50,
      maxToolCallsPerModelCall: 32, maxToolCallsPerExecution: 256,
      maxConcurrentToolExecutions: 2, modelCallTimeoutMs: 1_000,
      toolExecutionTimeoutMs: 1_000, maxModelCallAttempts: 1,
      modelRetryDelayMs: 0, maxContextOverflowRecoveries: 1,
      providerRequestMaxRetries: 0, providerRequestMaxRetryDelayMs: 0,
    },
  };
  const executions = createAgentExecutions({
    ids: options.ids,
    clock: options.clock,
    terminalRetentionMs: options.terminalRetentionMs,
    events: options.events,
    launch: (input) => launchAgentExecution(input, options),
  });
  const agent = createDiscovery({
    interests: options.interests,
    dailyDiscovery: {
      ...options.dailyDiscovery,
      startExecution: (request) => executions.start(request),
      now: options.clock.now,
    },
  });
  return { agent, executions, repository, traceRecords };
}

function recorder(records: TraceJournalRecord[]): Observability {
  let id = 0;
  return createTraceRecorder({
    enqueue: (record) => { records.push(record); },
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date('2026-08-22T02:00:00.000Z'),
    links: {
      resolve: (target) => target.state === 'latest_incomplete'
        ? 'ffffffff-ffff-4fff-8fff-ffffffffffff'
        : records.find((record) => record.type === 'trace.started')?.traceId,
    },
  });
}

function throwingObservability(): Observability {
  const failure = () => { throw new Error('observability unavailable'); };
  return {
    withTrace: failure,
    withSpan: failure,
    recordContent: failure,
    recordEvent: failure,
    linkTrace: failure,
  } as Observability;
}

function successfulStreams() {
  return [
    toolStream('search', 'search_content', { sourceId: 'open_web', query: 'agent', mode: 'relevance', limit: 5 }),
    toolStream('select', 'select_recommendations', {
      items: [{ candidateId: 'candidate:1', recommendationReason: 'Useful today' }],
    }),
    textStream('done'),
  ];
}

function toolStream(id: string, name: string, argumentsValue: unknown) {
  return completedStream(assistant([{
    type: 'toolCall', id, name, arguments: argumentsValue as Record<string, unknown>,
  }], 'toolUse'));
}

function textStream(text: string) {
  return completedStream(assistant([{ type: 'text', text }], 'stop'));
}

function completedStream(message: AssistantMessage) {
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

function assistant(content: AssistantMessage['content'], stopReason: 'stop' | 'toolUse'): AssistantMessage {
  return {
    role: 'assistant', content, api: model.api, provider: model.provider, model: model.id,
    stopReason, timestamp: Date.now(),
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function addInterest(repository: ReturnType<typeof createDiscoveryRepository>) {
  repository.changeInterest({
    action: 'create', interestId: 'interest:seed', description: 'Agent',
    now: '2026-08-22T07:00:00.000+08:00',
  });
}

async function waitForStatus(
  repository: ReturnType<typeof createDiscoveryRepository>,
  status: 'published' | 'failed',
) {
  await vi.waitFor(() => expect(repository.getDailyBatch('2026-08-22')?.status).toBe(status), { timeout: 2_000 });
}

function fakeTimers() {
  const entries: Array<{ callback: () => void; delayMs: number }> = [];
  return {
    setTimeout(callback: () => void, delayMs: number) {
      const entry = { callback, delayMs };
      entries.push(entry);
      return entry;
    },
    clearTimeout(handle: unknown) {
      const index = entries.indexOf(handle as { callback: () => void; delayMs: number });
      if (index >= 0) entries.splice(index, 1);
    },
    pending: () => [...entries],
    fireNext() {
      const entry = entries.shift();
      if (!entry) throw new Error('No pending timer.');
      entry.callback();
    },
  };
}
