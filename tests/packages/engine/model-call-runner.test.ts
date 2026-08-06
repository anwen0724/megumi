/*
 * Protects the isolated logical ModelCall: stream consumption, response
 * validation, attempt isolation, retry, Context Overflow recovery and owner
 * preservation without any Run lifecycle involvement.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Api, AssistantMessage, Model } from '@megumi/ai';
import type { AnyEvent, EventPayloadByType, EventType } from '@megumi/events';
import type { Prompt } from '@megumi/context';
import { AssistantMessageEventStream } from '../../../packages/ai/src/utils/event-stream';
import {
  runModelCall,
  type RebuildPromptResult,
  type RunModelCallRequest,
} from '../../../packages/engine/src/model-call-runner';
import {
  assistantStream,
  assistantStreamWithUsage,
  compactedOverflowCompaction,
  errorOverflowStream,
  model,
  partialNeverEndingStream,
  retryableFailedStream,
} from './runs-test-fixtures';

const policy = {
  maxModelCallAttempts: 1,
  modelCallTimeoutMs: 1_000,
  modelRetryDelayMs: 0,
  maxContextOverflowRecoveries: 1,
  providerRequestMaxRetries: 0,
  providerRequestMaxRetryDelayMs: 0,
};

const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function baseMessage(
  overrides: Partial<Omit<AssistantMessage, 'role' | 'api' | 'provider' | 'model' | 'timestamp'>>,
): AssistantMessage {
  return {
    role: 'assistant',
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: zeroUsage,
    timestamp: 1,
    ...overrides,
  } as AssistantMessage;
}

function createHarness(input: {
  streams?: AssistantMessageEventStream[];
  contextCompact?: (request: import('@megumi/context').CompactContextRequest) => Promise<import('@megumi/context').CompactContextResult>;
  buildPrompt?: () => Promise<RebuildPromptResult>;
  policy?: Partial<typeof policy>;
  runnerModel?: Model<Api>;
} = {}) {
  const events: AnyEvent[] = [];
  const logs: Array<{ level: string; event: string }> = [];
  const measurements: Array<{ name: string; value: number }> = [];
  const streams = [...(input.streams ?? [assistantStream('done')])];
  const models = {
    streamSimple: ((_runnerModel: unknown, _prompt: unknown, streamOptions: { signal?: AbortSignal }) => {
      const stream = streams.shift();
      if (!stream) throw new Error('No model stream configured.');
      const settleAborted = () => {
        const aborted = baseMessage({
          content: [],
          stopReason: 'aborted',
          errorMessage: 'Request was aborted',
        });
        stream.push({ type: 'error', reason: 'aborted', error: aborted });
        stream.end(aborted);
      };
      if (streamOptions?.signal) {
        if (streamOptions.signal.aborted) settleAborted();
        else streamOptions.signal.addEventListener('abort', settleAborted, { once: true });
      }
      return stream;
    }) as never,
  };
  const compact: (request: import('@megumi/context').CompactContextRequest) => Promise<import('@megumi/context').CompactContextResult>
    = input.contextCompact ?? (async () => ({
      status: 'nothing_to_compact' as const,
      reason: 'no_historical_messages',
    }));
  const buildPrompt = input.buildPrompt ?? vi.fn(async (): Promise<RebuildPromptResult> => ({
    status: 'ready',
    prompt: { systemPrompt: 'rebuilt', messages: [], tools: [] },
  }));
  const prompt: Prompt = { systemPrompt: 'test', messages: [], tools: [] };
  const abortController = new AbortController();
  const request: RunModelCallRequest = {
    runId: 'run:1',
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    model: input.runnerModel ?? model,
    modelCallId: 'model-call:1',
    messageId: 'message:1',
    prompt,
    buildPrompt,
    signal: abortController.signal,
    projection: { text: '', thinking: '' },
    events: {
      publish: <TType extends EventType>(type: TType, payload: EventPayloadByType[TType]) => {
        events.push({
          type,
          payload,
          sessionId: 'session:1',
          runId: 'run:1',
          sequence: events.length + 1,
        } as AnyEvent);
      },
    },
    observation: {
      recordLog: (log) => { logs.push({ level: log.level, event: log.event }); },
      recordMeasurement: (measurement) => { measurements.push({ name: measurement.name, value: measurement.value }); },
    },
    models,
    context: { compact },
    policy: { ...policy, ...input.policy },
    clock: { now: () => '2026-07-31T00:00:00.000Z' },
  };
  return {
    request,
    run: () => runModelCall(request),
    events,
    logs,
    measurements,
    compact,
    buildPrompt,
    abort: () => abortController.abort(),
  };
}

describe('ModelCall Runner', () => {
  it('streams full-snapshot updates under one Message identity and returns the settled message', async () => {
    const harness = createHarness({ streams: [assistantStream('final answer')] });
    const outcome = await harness.run();

    expect(outcome.status).toBe('completed');
    if (outcome.status !== 'completed') return;
    expect(outcome.message.content).toEqual([{ type: 'text', text: 'final answer' }]);
    expect(outcome.toolCalls).toEqual([]);
    const updates = harness.events.filter((event) => event.type === 'message.update');
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update.payload).toMatchObject({ messageId: 'message:1', content: 'final answer' });
    }
  });

  it('rejects invalid terminals: empty and length-truncated; accepts valid tool use', async () => {
    const emptyStream = new AssistantMessageEventStream();
    emptyStream.push({ type: 'start', partial: baseMessage({ content: [], stopReason: 'stop' }) });
    emptyStream.push({ type: 'done', reason: 'stop', message: baseMessage({ content: [], stopReason: 'stop' }) });
    const empty = await createHarness({ streams: [emptyStream] }).run();
    expect(empty).toMatchObject({
      status: 'failed',
      failure: { code: 'model_call_failed', owner: 'ai', causeCode: 'empty_response', retryable: true },
    });

    const lengthStream = new AssistantMessageEventStream();
    lengthStream.push({ type: 'start', partial: baseMessage({ content: [], stopReason: 'length' }) });
    lengthStream.push({ type: 'done', reason: 'length', message: baseMessage({
      content: [{ type: 'text', text: 'partial' }],
      stopReason: 'length',
    }) });
    const truncated = await createHarness({ streams: [lengthStream] }).run();
    expect(truncated).toMatchObject({
      status: 'failed',
      failure: { code: 'model_call_failed', owner: 'ai', causeCode: 'output_truncated', retryable: false },
    });

    const toolUse = await createHarness({
      streams: [assistantStream('', { id: 'call:1', name: 'lookup', arguments: { value: 'x' } })],
    }).run();
    expect(toolUse).toMatchObject({
      status: 'completed',
      toolCalls: [{
        toolCallId: 'call:1',
        sourceModelCallId: 'model-call:1',
        callOrder: 0,
        toolName: 'lookup',
      }],
    });
  });

  it('clears the previous attempt projection before a retry and keeps one identity', async () => {
    const harness = createHarness({
      streams: [retryableFailedStream('stale text'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
    });
    const outcome = await harness.run();

    expect(outcome.status).toBe('completed');
    const updates = harness.events
      .filter((event) => event.type === 'message.update')
      .map((event) => (event.payload as { content: string }).content);
    // The stale text was projected, then reset, then replaced by the retry.
    expect(updates[0]).toBe('stale text');
    expect(updates).toContain('');
    expect(updates.at(-1)).toBe('answer');
    const reset = harness.events.findIndex(
      (event) => event.type === 'message.update' && event.payload.content === '',
    );
    const retryStarted = harness.events.findIndex((event) => event.type === 'turn.retry.started');
    expect(reset).toBeLessThan(retryStarted);
    // The same Message identity carried every streamed update.
    for (const event of harness.events.filter((item) => item.type === 'message.update')) {
      expect(event.payload.messageId).toBe('message:1');
    }
  });

  it('recovers a Context Overflow through compaction and the loop-provided Prompt rebuild', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const harness = createHarness({
      contextCompact: compact,
      streams: [
        assistantStreamWithUsage('overflowing', {
          input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
        }),
        assistantStream('final answer'),
      ],
    });
    const outcome = await harness.run();

    expect(outcome.status).toBe('completed');
    expect(compact).toHaveBeenCalledWith(expect.objectContaining({
      trigger: 'overflow',
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      // The already-resolved ModelCall Tools are handed to compaction.
      tools: [],
    }));
    expect(harness.buildPrompt).toHaveBeenCalledTimes(1);
    // No new Turn or Message identity was introduced by the recovery.
    expect(harness.events.filter((event) => event.type === 'turn.started')).toHaveLength(0);
    expect(harness.events.filter((event) => event.type === 'message.started')).toHaveLength(0);
  });

  it('converts a failed Prompt rebuild after compaction into a Context failure', async () => {
    const compact = vi.fn(compactedOverflowCompaction);
    const buildPrompt = vi.fn(async () => ({
      status: 'failed' as const,
      failure: { code: 'context_build_failed', message: 'Prompt rebuild failed.', retryable: false },
    }));
    const harness = createHarness({
      contextCompact: compact,
      buildPrompt,
      streams: [assistantStreamWithUsage('overflowing', {
        input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
      })],
    });
    const outcome = await harness.run();

    // The known Context failure keeps its code and message; it never becomes
    // a generic internal error.
    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'context_failed',
        owner: 'context',
        causeCode: 'context_build_failed',
        message: 'Prompt rebuild failed.',
        retryable: false,
      },
    });
    expect(compact).toHaveBeenCalledTimes(1);
    expect(buildPrompt).toHaveBeenCalledTimes(1);
  });

  it('returns the current attempt projection when cancelled', async () => {
    const harness = createHarness({ streams: [partialNeverEndingStream('partial answer')] });
    const running = harness.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.abort();
    const outcome = await running;

    expect(outcome.status).toBe('cancelled');
    if (outcome.status !== 'cancelled') return;
    expect(outcome.partial).toEqual({ text: 'partial answer', thinking: '' });
  });

  it('preserves AI owner and provider error code on an exhausted retryable failure', async () => {
    const harness = createHarness({
      streams: [retryableFailedStream('boom'), retryableFailedStream('boom again')],
      policy: { maxModelCallAttempts: 2 },
    });
    const outcome = await harness.run();

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'model_call_failed',
        owner: 'ai',
        causeCode: 'provider_error',
        retryable: true,
      },
    });
    const retryFailed = harness.events.find((event) => event.type === 'turn.retry.failed');
    expect(retryFailed?.payload).toMatchObject({ error: { code: 'model_call_failed' } });
  });

  it('preserves Context owner and codes when overflow recovery is exhausted', async () => {
    const harness = createHarness({
      streams: [assistantStreamWithUsage('overflowing', {
        input: 64_001, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 64_002,
      })],
      policy: { maxContextOverflowRecoveries: 0 },
    });
    const outcome = await harness.run();

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'context_failed',
        owner: 'context',
        causeCode: 'context_window_exceeded',
        retryable: false,
      },
    });
  });

  it('preserves the Context compaction failure code', async () => {
    const compact: (request: import('@megumi/context').CompactContextRequest) => Promise<import('@megumi/context').CompactContextResult>
      = async () => ({
        status: 'failed' as const,
        failure: { code: 'compaction_failed', message: 'Summary generation failed.', retryable: false },
      });
    const harness = createHarness({
      contextCompact: compact,
      streams: [errorOverflowStream()],
    });
    const outcome = await harness.run();

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: {
        code: 'context_failed',
        owner: 'context',
        causeCode: 'compaction_failed',
      },
    });
    // No rebuild happened after the failed compaction.
    expect(harness.buildPrompt).not.toHaveBeenCalled();
  });

  it('records every finished attempt as an observation without dropping retries', async () => {
    const harness = createHarness({
      streams: [retryableFailedStream('attempt one'), assistantStream('answer')],
      policy: { maxModelCallAttempts: 2 },
    });
    await harness.run();

    expect(harness.logs.filter((log) => log.event === 'model.call.attempt.finished')).toHaveLength(2);
    expect(harness.measurements.filter((m) => m.name === 'model.call.attempt').map((m) => m.value)).toEqual([1, 2]);
  });
});
