// @vitest-environment node
import { expect, it, vi } from 'vitest';
import type { Context } from '@megumi/ai';
import { createMemoryExtraction } from '@megumi/application/memory/extraction';
import type { ExtractionModel } from '@megumi/application/memory/extraction-contracts';
import { ConfigurationSchema } from '@megumi/application/settings/settings-schema';
import { createMemorySources } from '@megumi/application/coding/sessions/memory-sources';
import { createSourceFixture } from './source-fixture';
import { composeObservability } from '@megumi/application/observability/index';
import { createTraceRecorder } from '@megumi/application/observability/trace/trace-recorder';
import { ObservabilityMemoryStorage } from '../observability/observability-memory-storage';

export function extractionFixture() {
  const f = createSourceFixture();
  const configuration = ConfigurationSchema.parse({}).memory;
  configuration.extractModel = { providerId: 'test', modelId: 'model' };
  configuration.generateMemories = true;
  const contexts: Context[] = [];
  const model: ExtractionModel['model'] = { id: 'model', name: 'Test', provider: 'test', api: 'openai-completions',
    baseUrl: 'https://example.test', reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 2048,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const response = (text: string): Awaited<ReturnType<ExtractionModel['complete']>> => ({ role: 'assistant',
    api: model.api, provider: model.provider, model: model.id, content: [{ type: 'text', text }], stopReason: 'stop', timestamp: 0,
    usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  const complete = vi.fn<ExtractionModel['complete']>(async context => {
    contexts.push(context);
    return response(JSON.stringify({ rawMemory: 'Prefers TypeScript.', rolloutSummary: 'React learning.', rolloutSlug: 'react' }));
  });
  const runningSessions = new Set<string>();
  const sources = createMemorySources({ store: f.store, isSessionRunning: sessionId => runningSessions.has(sessionId) });
  const options = { database: f.database, sources, readConfiguration: () => configuration,
    resolveModel: async () => ({ model, complete, secrets: ['secret-value'] }), workspaceDirectory: () => 'C:/memory-test',
    now: () => Date.parse('2026-10-08T12:00:00Z') };
  const extraction = createMemoryExtraction(options);
  return { ...f, configuration, contexts, complete, response, options, extraction, runningSessions };
}

it('extracts persisted evidence and reuses the successful version after recreating the service', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1', 'I prefer TypeScript. My test key is secret-value.');
    const result = await f.extraction.extract();
    expect(result.status).toBe('completed');
    expect(f.extraction.getExtraction('s1')).toMatchObject({ rawMemory: 'Prefers TypeScript.' });
    expect(JSON.stringify(f.contexts)).toContain('I prefer TypeScript.');
    expect(JSON.stringify(f.contexts)).not.toContain('secret-value');
    expect(f.extraction.getExtraction('s1')?.coverage.includedMessageIds).toEqual(['u1']);
    const restarted = createMemoryExtraction(f.options);
    await restarted.extract();
    expect(f.complete).toHaveBeenCalledTimes(1);
    await restarted.shutdown();
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it('excludes the triggering and running sessions but still extracts an archived persisted session', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    expect(await f.extraction.extract({ triggerSessionId: 's1' })).toMatchObject({ result: 'unchanged', jobs: [] });
    const running = createMemoryExtraction({ ...f.options, sources: createMemorySources({ store: f.store, isSessionRunning: () => true }) });
    expect(await running.extract()).toMatchObject({ result: 'unchanged', jobs: [] });
    await running.shutdown();
    f.store.archiveSession({ session_id: 's1', archived_at: '2026-10-08T12:00:00Z' });
    expect(await f.extraction.extract()).toMatchObject({ result: 'extracted', jobs: [{ status: 'succeeded' }] });
    expect(f.complete).toHaveBeenCalledTimes(1);
  } finally { await f.extraction.shutdown(); f.database.close(); }
});


it.each(['not JSON', '```json\n{"rawMemory":"","rolloutSummary":"","rolloutSlug":""}\n```',
  '{"rawMemory":"","rolloutSummary":"oops","rolloutSlug":""}',
  '{"rawMemory":"ok","rolloutSummary":"ok","rolloutSlug":"","extra":true}'])('records invalid output as a failed attempt without a success watermark: %s', async text => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    f.complete.mockResolvedValue(f.response(text));
    const result = await f.extraction.extract();
    expect(result).toMatchObject({ status: 'completed', jobs: [{ status: 'failed', error: { code: 'INVALID_RESULT' } }] });
    expect(f.extraction.getExtraction('s1')).toBeUndefined();
    expect(f.database.prepare({ sql: 'SELECT dirty_revision FROM memory_state' }).get()).toEqual({ dirty_revision: 0 });
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it('persists an empty success and never retries it as a failure', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    f.complete.mockResolvedValue(f.response('{"rawMemory":"","rolloutSummary":"","rolloutSlug":""}'));
    await f.extraction.extract();
    await f.extraction.extract();
    expect(f.complete).toHaveBeenCalledTimes(1);
    expect(f.extraction.getExtraction('s1')).toMatchObject({ rawMemory: '', rolloutSummary: '' });
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it.each(['source', 'exclusion', 'disabled', 'cancelled', 'clear'] as const)('rejects a delayed response after %s changes', async change => {
  const f = extractionFixture();
  let release!: (value: ReturnType<typeof f.response>) => void;
  try {
    await f.user('u1');
    f.complete.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const controller = new AbortController();
    const pending = f.extraction.extract({ signal: controller.signal });
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledOnce());
    if (change === 'source') await f.user('u2', 'I now prefer JavaScript.');
    if (change === 'exclusion') f.database.prepare({ sql: "UPDATE memory_sources SET eligibility = 'excluded', eligibility_version = eligibility_version + 1" }).run();
    if (change === 'disabled') f.configuration.generateMemories = false;
    if (change === 'cancelled') controller.abort();
    if (change === 'clear') f.database.prepare({ sql: 'UPDATE memory_state SET clear_pending = 1, control_revision = control_revision + 1' }).run();
    release(f.response('{"rawMemory":"stale","rolloutSummary":"stale","rolloutSlug":""}'));
    const result = await pending;
    expect(result).toMatchObject({ jobs: [{ status: change === 'cancelled' || change === 'disabled' ? 'cancelled' : 'superseded' }] });
    expect(f.extraction.getExtraction('s1')).toBeUndefined();
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it.each([false, true])('limits concurrency and rechecks queued activity (foreground starts: %s)', async startsForeground => {
  const f = extractionFixture();
  const releases: (() => void)[] = [];
  try {
    await f.user('u1');
    for (let i = 2; i <= 12; i++) {
      f.store.insertSession({ session_id: `s${i}`, workspace_id: 'w1', title: 'Synthetic', status: 'active', created_at: '2026-10-01', updated_at: '2026-10-01' });
      await f.history.saveUserMessage({ session_id: `s${i}`, message_id: `u${i}`, display_content: [{ type: 'text', text: `React ${i}` }],
        model_content: [{ type: 'text', text: `React ${i}` }], created_at: '2026-10-02T00:00:00.000Z' });
    }
    f.configuration.maxSourcesPerRun = 10;
    let active = 0; let maximum = 0;
    f.complete.mockImplementation(async () => {
      active++; maximum = Math.max(maximum, active);
      const first = releases.length === 0;
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return f.response(first ? 'invalid'
        : '{"rawMemory":"React","rolloutSummary":"Learning","rolloutSlug":""}');
    });
    const pending = f.extraction.extract();
    try {
      await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(8), { timeout: 500 });
      if (startsForeground) for (let i = 1; i <= 12; i++) f.runningSessions.add(`s${i}`);
    }
    finally { f.complete.mockImplementation(async () => f.response('{"rawMemory":"React","rolloutSummary":"Learning","rolloutSlug":""}')); releases.forEach(release => release()); await pending; }
    const result = await pending;
    expect(result).toMatchObject({ status: 'completed', result: 'partial' });
    if (result.status !== 'completed') throw new Error('Batch not settled');
    expect(result.jobs.filter(job => job.status === 'failed')).toHaveLength(1);
    expect(result.jobs.filter(job => job.status === 'succeeded')).toHaveLength(startsForeground ? 7 : 9);
    expect(maximum).toBe(8);
    expect(f.complete).toHaveBeenCalledTimes(startsForeground ? 8 : 10);
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it('reports an unreadable original chain instead of pretending there was no source', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    // A storage-level corruption models a missing original record, not a model failure.
    f.database.prepare({ sql: "UPDATE session_entries SET message_id = 'missing' WHERE message_id = 'u1'" }).run();
    const result = await f.extraction.extract();
    expect(result).toMatchObject({ status: 'completed', result: 'failed', sourceFailures: [{ sessionId: 's1', error: { code: 'SOURCE_UNAVAILABLE' } }] });
    expect(f.complete).not.toHaveBeenCalled();
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it('retains an earlier successful version through failure, then replaces it with a new empty success', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    await f.extraction.extract();
    const previous = f.extraction.getExtraction('s1')!;
    await f.user('u2', 'Cancel the old preference.');
    f.complete.mockResolvedValue(f.response('invalid'));
    const failed = await f.extraction.extract();
    expect(f.extraction.getExtraction('s1')).toEqual(previous);
    if (failed.status !== 'completed') throw new Error('Batch not settled');
    f.complete.mockResolvedValue(f.response('{"rawMemory":"","rolloutSummary":"","rolloutSlug":""}'));
    await f.extraction.extract({ failedJobId: failed.jobs[0].jobId });
    expect(f.extraction.getExtraction('s1')).toMatchObject({ rawMemory: '' });
    expect(f.extraction.getExtraction('s1')?.sourceVersion).not.toBe(previous.sourceVersion);
    expect(f.database.prepare({ sql: 'SELECT source_version FROM memory_extractions WHERE session_id = ?' }).all(['s1'])).toHaveLength(2);
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it.each(['timeout', 'shutdown', 'disable'] as const)('settles %s even when the provider ignores abort', async kind => {
  const f = extractionFixture();
  let release!: (value: ReturnType<typeof f.response>) => void;
  try {
    await f.user('u1');
    f.complete.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    vi.useFakeTimers();
    const pending = f.extraction.extract();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.complete).toHaveBeenCalledOnce();
    let settled = false;
    pending.then(() => { settled = true; });
    if (kind === 'shutdown') void f.extraction.shutdown();
    if (kind === 'disable') f.configuration.generateMemories = false;
    await vi.advanceTimersByTimeAsync(kind === 'timeout' ? 180001 : 1000);
    const settledBeforeResponse = settled;
    release(f.response('{"rawMemory":"late","rolloutSummary":"late","rolloutSlug":""}'));
    const result = await pending;
    expect(settledBeforeResponse).toBe(true);
    expect(result).toMatchObject({ jobs: [{ status: kind === 'timeout' ? 'failed' : 'cancelled' }] });
    expect(f.extraction.getExtraction('s1')).toBeUndefined();
  } finally { vi.useRealTimers(); await f.extraction.shutdown(); f.database.close(); }
});

it('classifies provider abort rejection as cancellation without consuming a failed attempt', async () => {
  const f = extractionFixture();
  try {
    await f.user('u1');
    f.complete.mockImplementation((_context, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('Provider aborted secret-value')), { once: true });
    }));
    const controller = new AbortController();
    const pending = f.extraction.extract({ signal: controller.signal });
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toMatchObject({ jobs: [{ status: 'cancelled', error: { code: 'CANCELLED' } }] });
  } finally { await f.extraction.shutdown(); f.database.close(); }
});

it('records job identity and coverage without secret content; diagnostic failure cannot undo the result', async () => {
  const f = extractionFixture();
  const trace = composeObservability({ rootDirectory: 'memory-observability', storage: new ObservabilityMemoryStorage() });
  const extraction = createMemoryExtraction({ ...f.options, observability: trace.observability });
  try {
    await f.user('u1', 'React secret-value');
    const result = await extraction.extract();
    await trace.flush();
    const traces = await trace.queries.listTraces();
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ traceKind: 'memory_extraction', status: 'ok' });
    expect(JSON.stringify(traces)).not.toContain('secret-value');
    if (result.status !== 'completed') throw new Error('Extraction failed');
    expect(traces[0].correlations).toContainEqual(expect.objectContaining({ modelCallId: result.jobs[0].jobId, contentDigest: result.jobs[0].sourceVersion }));
    const detail = await trace.queries.getTrace(traces[0].traceId);
    expect(detail?.spans.flatMap(span => span.events.map(item => item.event))).toContainEqual(expect.objectContaining({
      type: 'memory.extraction.settled', jobId: result.jobs[0].jobId, includedMessages: 1, omittedMessages: 0,
      inputTokens: 100, outputTokens: 20, status: 'succeeded',
    }));
    const broken = createMemoryExtraction({ ...f.options, observability: createTraceRecorder({ enqueue: () => { throw new Error('Disk full'); } }) });
    await f.user('u2', 'Prefer TypeScript');
    await broken.extract();
    expect(broken.getExtraction('s1')?.coverage.includedMessageIds).toContain('u2');
    await broken.shutdown();
  } finally { await extraction.shutdown(); await trace.shutdown(); await f.extraction.shutdown(); f.database.close(); }
});
