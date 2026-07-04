// Verifies ModelCallRunner behavior at the AiClient boundary without provider protocol parsing.
import { describe, expect, it } from 'vitest';
import { AssistantEventStream, type AiClient } from '@megumi/ai';
import type { ModelInputContext, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ModelCallRuntimeResolverPort, ProviderRuntimeConfig } from '@megumi/coding-agent/agent-loop/model-call';
import { ModelCallRunner } from '@megumi/coding-agent/agent-loop/model-call';
import { ProviderRuntimeResolutionError } from '@megumi/coding-agent/settings';

const runtimeContext = {
  requestId: 'request-1',
  traceId: 'trace-model-call-1',
  debugId: 'debug-model-call-1',
  operationName: 'session.message.send',
  source: 'main',
  createdAt: '2026-05-17T00:00:00.000Z',
} as const;

const config: ProviderRuntimeConfig = {
  providerId: 'deepseek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-deepseek',
  modelId: 'deepseek-v4-flash',
};

const request: ModelStepRuntimeRequest = {
  requestId: 'request-1',
  sessionId: 'session-1',
  runId: 'run-1',
  stepId: 'step-1',
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  createdAt: '2026-05-17T00:00:00.000Z',
  runtimeContext,
  inputContext: inputContext(),
};

describe('ModelCallRunner', () => {
  it('resolves runtime config and streams model calls through the injected AiClient', async () => {
    const resolvedInputs: unknown[] = [];
    let capturedSignal: AbortSignal | undefined;
    const runner = new ModelCallRunner({
      resolver: resolver((input) => {
        resolvedInputs.push(input);
        return config;
      }),
      aiClientFactory: ({ config: resolvedConfig }) => {
        expect(resolvedConfig).toBe(config);
        return aiClient({
          stream(input) {
            capturedSignal = input.signal;
            expect(input.credential).toEqual({ type: 'api_key', value: 'sk-deepseek' });
            return AssistantEventStream.from([
              { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
              { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'stop' } },
            ]);
          },
        });
      },
    });

    const events = await collect(runner.streamModelCall(request));

    expect(resolvedInputs).toEqual([{
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      runtimeContext,
    }]);
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.output.delta',
      'model.step.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('resolves runtime config and completes model calls through the injected AiClient', async () => {
    const runner = new ModelCallRunner({
      resolver: resolver(() => config),
      aiClientFactory: () => aiClient({
        async complete(input) {
          expect(input.credential).toEqual({ type: 'api_key', value: 'sk-deepseek' });
          return {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'checked memory rules' },
              { type: 'text', text: '{ "candidates": [] }' },
            ],
            stopReason: 'stop',
            usage: {
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
            },
          };
        },
      }),
    });

    await expect(runner.completeModelCall(request)).resolves.toEqual({
      ok: true,
      text: '{ "candidates": [] }',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
      providerStates: [{
        modelStepId: 'step-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        blocks: [{
          type: 'thinking',
          text: 'checked memory rules',
        }],
      }],
    });
  });

  it('passes structured output targets and returns parsed structured completion values', async () => {
    const structuredRequest: ModelStepRuntimeRequest = {
      ...request,
      structuredOutput: {
        name: 'memory_extraction_candidates',
        schema: {
          type: 'object',
          properties: { candidates: { type: 'array' } },
          required: ['candidates'],
          additionalProperties: false,
        },
      },
    };
    const runner = new ModelCallRunner({
      resolver: resolver(() => config),
      aiClientFactory: () => aiClient({
        async complete(input) {
          expect(input.structuredOutput).toEqual(structuredRequest.structuredOutput);
          return {
            role: 'assistant',
            content: [
              { type: 'text', text: '{ "candidates": [] }' },
            ],
            stopReason: 'stop',
          };
        },
      }),
    });

    await expect(runner.completeModelCall(structuredRequest)).resolves.toEqual({
      ok: true,
      text: '{ "candidates": [] }',
      structuredOutput: { candidates: [] },
      finishReason: 'stop',
    });
  });

  it('fails structured completion when provider output is not JSON', async () => {
    const structuredRequest: ModelStepRuntimeRequest = {
      ...request,
      structuredOutput: {
        name: 'memory_extraction_candidates',
        schema: { type: 'object' },
      },
    };
    const runner = new ModelCallRunner({
      resolver: resolver(() => config),
      aiClientFactory: () => aiClient({
        async complete() {
          return {
            role: 'assistant',
            content: [{ type: 'text', text: 'not json' }],
          };
        },
      }),
    });

    await expect(runner.completeModelCall(structuredRequest)).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'runtime_protocol_violation',
        source: 'provider',
      },
    });
  });

  it('maps runtime resolution errors to failed stream events', async () => {
    const runner = new ModelCallRunner({
      resolver: {
        async resolveProviderRuntimeConfig() {
          throw new ProviderRuntimeResolutionError({
            code: 'provider_missing_api_key',
            message: 'Provider API key is missing.',
            severity: 'error',
            retryable: false,
            source: 'provider',
            details: {
              providerId: 'deepseek',
              modelId: 'deepseek-v4-flash',
            },
          });
        },
      },
      aiClientFactory: () => {
        throw new Error('AiClient should not be created');
      },
    });

    await expect(collect(runner.streamModelCall(request))).resolves.toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          error: expect.objectContaining({
            code: 'provider_missing_api_key',
            message: 'Provider API key is missing.',
            retryable: false,
            source: 'provider',
          }),
        },
      }),
    ]);
  });

  it('does not expose raw generic error causes in failed stream events', async () => {
    const runner = new ModelCallRunner({
      resolver: {
        async resolveProviderRuntimeConfig() {
          throw new Error('unexpected provider setup failed with sk-secret-raw-header');
        },
      },
      aiClientFactory: () => {
        throw new Error('AiClient should not be created');
      },
    });

    const events = await collect(runner.streamModelCall(request));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        payload: {
          error: expect.objectContaining({
            code: 'runtime_unknown',
            message: 'Model call runner failed.',
            retryable: true,
            source: 'main',
            debugId: 'debug-model-call-1',
          }),
        },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('sk-secret-raw-header');
    expect(JSON.stringify(events)).not.toContain('cause');
  });

  it('keeps failure event sequence monotonic when the AiClient stream throws after streaming starts', async () => {
    const runner = new ModelCallRunner({
      resolver: resolver(() => config),
      aiClientFactory: () => aiClient({
        stream() {
          return AssistantEventStream.from((async function* () {
            yield { type: 'content_block_delta' as const, index: 0, delta: { type: 'text_delta' as const, text: 'Hello' } };
            throw new Error('unexpected provider stream failure');
          })());
        },
      }),
    });

    const events = await collect(runner.streamModelCall(request));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.output.delta',
      'run.failed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it('cancels active model call requests by request id', async () => {
    let capturedSignal: AbortSignal | undefined;
    const runner = new ModelCallRunner({
      resolver: resolver(() => config),
      aiClientFactory: () => aiClient({
        stream(input) {
          capturedSignal = input.signal;
          return AssistantEventStream.from([
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
          ]);
        },
      }),
    });
    const iterator = runner.streamModelCall(request)[Symbol.asyncIterator]();

    await iterator.next();

    expect(runner.cancelModelCall('request-1')).toBe(true);
    expect(capturedSignal?.aborted).toBe(true);
  });
});

function resolver(
  resolve: (
    input: Parameters<ModelCallRuntimeResolverPort['resolveProviderRuntimeConfig']>[0],
  ) => ProviderRuntimeConfig | Promise<ProviderRuntimeConfig>,
): ModelCallRuntimeResolverPort {
  return {
    async resolveProviderRuntimeConfig(input) {
      return resolve(input);
    },
  };
}

function aiClient(overrides: Partial<AiClient>): AiClient {
  return {
    stream() {
      throw new Error('stream should not be called');
    },
    async complete() {
      throw new Error('complete should not be called');
    },
    ...overrides,
  };
}

function inputContext(): ModelInputContext {
  return {
    contextId: 'model-input-context:request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    parts: [{
      partId: 'part:current-turn:message-1',
      kind: 'current_turn',
      role: 'user',
      text: 'Hello',
      sourceRefs: [{ sourceId: 'session-message:message-1', sourceKind: 'current_user_message' }],
      priority: 95,
      budgetStatus: 'included_full',
    }],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 4096,
      inputTokenEstimate: 1,
      partBudgets: [{
        partId: 'part:current-turn:message-1',
        tokenEstimate: 1,
        budgetStatus: 'included_full',
      }],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [{ sourceId: 'session-message:message-1', reason: 'current_turn' }],
      excludedSources: [],
    },
    builtAt: '2026-05-17T00:00:00.000Z',
  };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}
